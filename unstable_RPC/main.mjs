import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import rpc from "discord-rich-presence";
import fetch from "node-fetch";
import { WebSocketServer } from "ws";
import http from "http";

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

setInterval(() => {
    if (!clients.has(defaultAppId)) {
        getOrCreateClient(defaultAppId);
    }
}, 5000);

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

    const appId = (hostname && appids[hostname]) ? appids[hostname] : defaultAppId;
    console.log(`${new Date().toISOString()} | [/update] site/hostname="${hostname}" → appId="${appId}"`);
    
    if (!appId) {
        console.error(`[/update] No appId found for hostname="${hostname}"`);
        return res.status(500).json({ ok: false, error: 'No appId configured' });
    }

    const now = Date.now();
    const last = lastChange.get(appId) || 0;
    // if (now - last < 5000) {
    //     return res.status(429).json({ ok: false, error: 'Sending requests too fast. ples slow down' });
    // }
    lastChange.set(appId, now);

    const client = getOrCreateClient(appId);
    if (!client) {
        return res.status(503).json({ ok: false, error: 'Discord RPC client not available' });
    }

    try {
        const presenceData = { ...body };
        delete presenceData.site;

        //console.log(presenceData);

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
            const appId = requestedAppId || (site && appids[site]) ? (requestedAppId || appids[site]) : defaultAppId;
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

    const appId = (hostname && appids[hostname]) ? appids[hostname] : defaultAppId;
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

