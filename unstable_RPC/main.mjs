import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import rpc from "discord-rich-presence";
import { WebSocketServer } from "ws";
import http from "http";
import { spawn, execSync } from "child_process";

const appidPath = path.join(process.cwd(), "appid");
let defaultAppId = null;

try {
    defaultAppId = fs.readFileSync(appidPath, "utf8").trim();
} catch (err) {
    console.error("Failed to read default appid:", err);
    process.exit(1);
}

let appids = {};
const appidsPath = path.join(process.cwd(), "appids.json");
if (fs.existsSync(appidsPath)) {
    try {
        appids = JSON.parse(fs.readFileSync(appidsPath, "utf8"));
        console.log("Loaded appids map for sites:", Object.keys(appids));
    } catch (e) {
        console.error("Failed to read appids.json, continuing with default appid:", e);
    }
}

const clients = new Map();

function getOrCreateClient(appId) {
    if (!appId) return null;
    if (clients.has(appId)) return clients.get(appId);
    try {
        const client = rpc(appId);
        console.log(`Connected to Discord RPC for appId=${appId}`);
        clients.set(appId, client);
        return client;
    } catch (err) {
        console.error(`Failed to create Discord RPC client for ${appId}:`, err);
        return null;
    }
}

// НЕ ТРОГАТЬ, ЭТО НА НОВЫЙ ГОД
// setInterval(() => {
//     if (!clients.has(defaultAppId)) {
//         getOrCreateClient(defaultAppId);
//     }
// }, 5000);

const CLEAR_DISCONNECT_DELAY = 200;

process.on("unhandledRejection", (reason, p) => {
    try {
        const msg = reason && reason.message ? reason.message : String(reason);
        if (typeof msg === "string") {
            const lm = msg.toLowerCase();
            if (lm.includes("connection closed")) {
                console.debug("Suppressed unhandled rejection (connection closed)");
                return;
            }
            if (lm.includes("buttons") && lm.includes("must be an array")) {
                console.debug("Suppressed unhandled rejection (invalid buttons array)");
                return;
            }
        }
    } catch (e) {}
    console.error("Unhandled Rejection at:", p, "reason:", reason);
});

process.on("uncaughtException", (err) => {
    try {
        const msg = err && err.message ? err.message : String(err);
        if (typeof msg === "string" && msg.toLowerCase().includes("connection closed")) {
            console.debug("Suppressed uncaught exception (connection closed)");
            return;
        }
    } catch (e) {}
    console.error("Uncaught Exception:", err);
});

const app = express();
app.use(bodyParser.json());

const lastChange = new Map();

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

app.post("/update", (req, res) => {
    const body = req.body;
    
    let hostname = body && body.site ? body.site : '';
    
    if (!hostname) {
        const origin = req.get('origin') || '';
        try {
            if (origin) hostname = new URL(origin).hostname;
        } catch (e) {}
    }
    
    if (!hostname) {
        const referer = req.get('referer') || '';
        try {
            if (referer) hostname = new URL(referer).hostname;
        } catch (e) {}
    }

    const appId = (hostname && appids[hostname]) ? appids[hostname] : false;//defaultAppId;
    console.log(`${new Date().toISOString()} | [/update] site/hostname="${hostname}" → appId="${appId}"`);
    
    if (!appId) {
        console.error(`[/update] No appId found for hostname="${hostname}"`);
        return res.status(500).json({ ok: false, error: 'No appId configured' });
    }

    const now = Date.now();
    const last = lastChange.get(appId) || 0;
    lastChange.set(appId, now);

    const client = getOrCreateClient(appId);
    if (!client) {
        return res.status(503).json({ ok: false, error: 'Discord RPC client not available' });
    }

    try {
        const presenceData = { ...body };
        delete presenceData.site;

        if (presenceData.buttons && !Array.isArray(presenceData.buttons)) {
            console.log(`[/update] Removing invalid buttons field for appId=${appId}`);
            delete presenceData.buttons;
        }

        client.updatePresence(presenceData);
        console.log(`[/update] Updated presence for appId="${appId}"`);
    } catch (err) {
        console.log(`[/update] Error updating presence for appId=${appId}:`, err);
        try { if (typeof client.disconnect === 'function') client.disconnect(); } catch (e) {}
        clients.delete(appId);
    }

    res.json({ ok: true });
});

app.get("/getClient", (req, res) => {
    let name = req.query.name;
    console.log("Client requested:", name);

    const filePath = path.join(process.cwd(), `/sites/${name}.js`);
    

    if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/javascript");
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).send(`${name} is not known`);
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Map(); 

const HEARTBEAT_TIMEOUT = 10000;
const HEARTBEAT_CHECK_INTERVAL = 5000;

wss.on('connection', (ws, req) => {
    console.log('[WS] connection from', req.socket.remoteAddress);

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (e) {
            console.error('[WS] invalid JSON message', e);
            return;
        }

        if (msg.type === 'register') {
            const site = msg.site || '';
            const requestedAppId = msg.appId || null;
            const appId = requestedAppId || (site && appids[site]) ? (requestedAppId || appids[site]) : null;//defaultAppId;
            if (!appId) {
                ws.send(JSON.stringify({ type: 'error', message: 'No appId configured' }));
                return;
            }

            wsClients.set(appId, { socket: ws, site, lastHeartbeat: Date.now() });
            getOrCreateClient(appId);
            ws.send(JSON.stringify({ type: 'registered', appId }));
            console.log(`[WS] registered loader for site=${site} appId=${appId}`);
            return;
        }

        if (msg.type === 'heartbeat') {
            for (const [appId, info] of wsClients.entries()) {
                if (info.socket === ws) {
                    info.lastHeartbeat = Date.now();
                    break;
                }
            }
            return;
        }
    });

    ws.on('close', () => {
        for (const [appId, info] of wsClients.entries()) {
            if (info.socket === ws) {
                console.log(`[WS] socket closed for appId=${appId}, clearing presence`);
                const client = clients.get(appId);
                if (client) {
                    try {
                        if (typeof client.clearPresence === 'function') {
                            client.clearPresence();
                            console.log(`Cleared presence for appId=${appId}`);
                        } else if (typeof client.updatePresence === 'function') {
                            client.updatePresence({});
                            console.log(`Cleared presence via updatePresence for appId=${appId}`);
                        }
                    } catch (err) {
                        console.log(`Error clearing presence for ${appId}:`, err);
                    }

                    const clientRef = client;
                    setTimeout(() => {
                        try { if (clientRef && typeof clientRef.disconnect === 'function') clientRef.disconnect(); } catch (e) {}
                        if (clients.get(appId) === clientRef) clients.delete(appId);
                    }, CLEAR_DISCONNECT_DELAY);
                }

                try { info.socket.close(); } catch (e) {}
                wsClients.delete(appId);
                break;
            }
        }
    });
    ws.on('error', (err) => console.error('[WS] socket error', err));
});

setInterval(() => {
    const now = Date.now();
    for (const [appId, info] of wsClients.entries()) {
        if (now - info.lastHeartbeat > HEARTBEAT_TIMEOUT) {
            console.log(`[WS] heartbeat timeout for appId=${appId}, clearing presence`);
            const client = clients.get(appId);
            if (client) {
                try {
                    if (typeof client.clearPresence === 'function') {
                        client.clearPresence();
                        console.log(`Cleared presence for appId=${appId}`);
                    } else if (typeof client.updatePresence === 'function') {
                        client.updatePresence({});
                        console.log(`Cleared presence via updatePresence for appId=${appId}`);
                    }
                } catch (err) {
                    console.log(`Error clearing presence for ${appId}:`, err);
                }

                const clientRef = client;
                setTimeout(() => {
                    try { if (clientRef && typeof clientRef.disconnect === 'function') clientRef.disconnect(); } catch (e) {}
                    if (clients.get(appId) === clientRef) clients.delete(appId);
                }, CLEAR_DISCONNECT_DELAY);
            }

            try { info.socket.close(); } catch (e) {}
            wsClients.delete(appId);
        }
    }
}, HEARTBEAT_CHECK_INTERVAL);

app.post("/clear", (req, res) => {
    const body = req.body || {};
    
    let hostname = body.site || '';
    
    if (!hostname) {
        const origin = req.get('origin') || '';
        try {
            if (origin) hostname = new URL(origin).hostname;
        } catch (e) {
        }
    }
    
    if (!hostname) {
        const referer = req.get('referer') || '';
        try {
            if (referer) hostname = new URL(referer).hostname;
        } catch (e) {
        }
    }

    const appId = (hostname && appids[hostname]) ? appids[hostname] : null;//defaultAppId;
    console.log(`[/clear] site/hostname="${hostname}" → appId="${appId}"`);
    
    if (!appId) return res.json({ ok: true });

    const client = clients.get(appId);
    if (client) {
        try {
            if (typeof client.clearPresence === 'function') {
                client.clearPresence();
                console.log(`[/clear] RPC presence cleared for appId="${appId}" (clearPresence)`);
            } else if (typeof client.updatePresence === 'function') {
                try {
                    client.updatePresence({});
                    console.log(`[/clear] RPC presence cleared for appId="${appId}" (updatePresence)`);
                } catch (err) {
                    console.log(`[/clear] Error clearing presence via updatePresence for ${appId}:`, err);
                }
            }
        } catch (err) {
            console.log(`[/clear] Error clearing RPC for ${appId}:`, err);
        }

        const clientRef = client;
        setTimeout(() => {
            try {
                if (clientRef && typeof clientRef.disconnect === 'function') {
                    clientRef.disconnect();
                    console.log(`[/clear] Discord RPC disconnected for appId="${appId}" after delay`);
                }
            } catch (err) {
                console.log(`[/clear] Error during delayed disconnect for ${appId}:`, err);
            } finally {
                if (clients.get(appId) === clientRef) clients.delete(appId);
            }
        }, CLEAR_DISCONNECT_DELAY);
    } else {
        console.log(`[/clear] No active client for appId="${appId}"`);
    }

    res.json({ ok: true });
});

server.listen(3020, () => {
    console.log("Listening on http://127.0.0.1:3020 (CORS + WebSocket enabled)");
});



// :: playerctl watcher only for linux, and sadly, but only for AIMP, as im lazy muhahahahaah
let playerctlProc = null;
let lastPlayerPresence = null;
let statusProc = null;
let isPlaying = false;
let playTicker = null;
let basePresence = null;

function startPlayerctlWatcher(appId) {
    if (!appId) return;
    if (playerctlProc) return;

    try {
        execSync('which playerctl');
    } catch (e) {
        console.log('playerctl not found in PATH, skipping playerctl watcher');
        return;
    }

    const fmt = "{{playerName}}||{{xesam:title}}||{{xesam:artist}}||{{xesam:url}}||{{mpris:length}}\\n";
    playerctlProc = spawn('playerctl', ['metadata', '--format', fmt, '--follow']);

    playerctlProc.stdout.on('data', (chunk) => {
        const raw = String(chunk);
        raw.split(/\\r?\\n/).forEach(line => {
            if (!line) return;
            const parts = line.split('||');
            const player = (parts[0]||'').trim();
            const title = (parts[1]||'').trim();
            const artist = (parts[2]||'').trim();
            const url = (parts[3]||'').trim();
            const lengthStr = (parts[4]||'').trim();

            if (!player) return;
            if (player.toLowerCase().indexOf('aimp') === -1) return;

            const client = getOrCreateClient(appId);
            if (!client) return;

            let titleText = title || 'Unknown track';
            let artistText = artist || '';

            if (!artistText || artistText === '-' || artistText === '–' || artistText === '—') {
                const parts = titleText.split(/\s[-–—]\s/);
                if (parts.length >= 2) {
                    artistText = parts[0].trim();
                    titleText = parts.slice(1).join(' - ').trim();
                }
            }

            let lengthSec = 0;
            try { lengthSec = Math.floor(parseInt(lengthStr || '0')/1000000); } catch(e) { lengthSec = 0; }

            const nowSec = Math.floor(Date.now()/1000);
            basePresence = { name: titleText, details: artistText, state: 'unstable.AIMP', type: 2, largeImageKey: 'aimp_old' };
            basePresence._lengthSec = lengthSec;

            let presence = Object.assign({}, basePresence);
            if (lengthSec > 0 && isPlaying) {
                try {
                    const posRaw = execSync('playerctl position').toString().trim();
                    const posSec = Math.floor(parseFloat(posRaw) || 0);
                    presence.startTimestamp = nowSec - posSec;
                    presence.endTimestamp = presence.startTimestamp + lengthSec;
                } catch (e) {
                    presence.startTimestamp = nowSec;
                    presence.endTimestamp = nowSec + lengthSec;
                }
            }

            const key = `${presence.name}|${presence.details}|${presence.endTimestamp||0}`;
            if (lastPlayerPresence === key) return;
            lastPlayerPresence = key;

            try {
                client.updatePresence(presence);
                console.log('[playerctl] Updated presence from AIMP:', presence);
            } catch (err) {
                console.error('[playerctl] Failed to update presence:', err);
            }
        });
    });

    playerctlProc.on('error', (err) => {
        console.error('[playerctl] process error', err);
        playerctlProc = null;
    });

    playerctlProc.on('close', (code, signal) => {
        console.log(`[playerctl] process closed code=${code} signal=${signal}`);
        playerctlProc = null;
        lastPlayerPresence = null;
        setTimeout(() => startPlayerctlWatcher(appId), 3000);
    });

    if (!statusProc) {
        try {
            statusProc = spawn('playerctl', ['status', '--follow']);
        } catch (e) {
            console.error('[playerctl status] failed to start', e);
            statusProc = null;
        }
    }

    if (statusProc) {
        statusProc.stdout.on('data', (chunk) => {
            const st = String(chunk).trim();
            if (!st) return;
            const wasPlaying = isPlaying;
            isPlaying = st.toLowerCase() === 'playing';

            if (isPlaying) {
                if (playTicker) clearInterval(playTicker);
                playTicker = setInterval(() => {
                    if (!basePresence) return;
                    const client = getOrCreateClient(appId || defaultAppId);
                    if (!client) return;
                    try {
                        const posRaw = execSync('playerctl position').toString().trim();
                        const posSec = Math.floor(parseFloat(posRaw) || 0);
                        const now = Math.floor(Date.now()/1000);
                        const dur = basePresence._lengthSec || 0;
                        let payload = Object.assign({}, basePresence);
                        if (dur > 0) {
                            const start = now - posSec;
                            payload.startTimestamp = start;
                            payload.endTimestamp = start + dur;
                        }
                        client.updatePresence(payload);
                    } catch (e) {}
                }, 5000);

                try {
                    if (basePresence) {
                        const client = getOrCreateClient(appId || defaultAppId);
                        if (client) {
                            const posRaw = execSync('playerctl position').toString().trim();
                            const posSec = Math.floor(parseFloat(posRaw) || 0);
                            const now = Math.floor(Date.now()/1000);
                            const dur = basePresence._lengthSec || 0;
                            let payload = Object.assign({}, basePresence);
                            if (dur > 0) {
                                const start = now - posSec;
                                payload.startTimestamp = start;
                                payload.endTimestamp = start + dur;
                            }
                            client.updatePresence(payload);
                            console.log('[playerctl] resumed — updated presence with timestamps');
                        }
                    }
                } catch (e) {}
            } else {
                if (playTicker) { clearInterval(playTicker); playTicker = null; }
                if (basePresence) {
                    const client = getOrCreateClient(appId || defaultAppId);
                    if (client) {
                        try {
                            let payload = Object.assign({}, basePresence);
                            delete payload.startTimestamp;
                            delete payload.endTimestamp;
                            payload.smallImageKey = 'pause';
                            client.updatePresence(payload);
                            console.log('[playerctl] paused — presence set to paused');
                        } catch (e) {}
                    }
                }
            }
        });

        statusProc.on('error', (err) => { console.error('[playerctl status] error', err); statusProc = null; });
        statusProc.on('close', (code, signal) => { console.log('[playerctl status] closed', code, signal); statusProc = null; if (playTicker) { clearInterval(playTicker); playTicker = null; } setTimeout(() => startPlayerctlWatcher(appId), 3000); });
    }
}


if (process.platform === 'linux') {
    startPlayerctlWatcher(appids['vk.com'] || defaultAppId);
    console.log('playerctl watcher initialized for Linux (if playerctl present)');
}

