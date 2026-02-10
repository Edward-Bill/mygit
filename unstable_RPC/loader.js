// ==UserScript==
// @name         All the RPCs Loader
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Loads RPC from local server
// @author       exec4tble
// @match        *://*/*
// @grant        none
// @connect      localhost
// ==/UserScript==

(function () {
    if (window.top !== window.self) return;
    if (window.RPC_WS_LOADER) return;
    window.RPC_WS_LOADER = null;

    const SERVER_URL = "http://127.0.0.1:3020";
    const WS_URL = "ws://127.0.0.1:3020/ws";
    let ws = null;
    let hbInterval = null;

    function loadClient() {
        fetch(`${SERVER_URL}/getClient?name=${window.location.hostname}`)
            .then(r => r.text())
            .then(code => {
                const script = document.createElement("script");
                script.textContent = code;
                document.head.appendChild(script);
                console.log("RPC loaded from local server");
            })
            .catch(err => {
                console.error("Failed to load RPC:", err)
            });
    }

    function connectWS() {
        try {
            ws = new WebSocket(WS_URL);
            ws.addEventListener('open', () => {
                console.log('RPC WS connected');
                window.RPC_WS_LOADER = ws;
                const siteName = window.location.hostname;
                ws.send(JSON.stringify({ type: 'register', site: siteName }));

                hbInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }));
                }, 4000);

                loadClient();
            });

            ws.addEventListener('message', (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === 'registered') console.log('RPC registered for appId', msg.appId);
                    if (msg.type === 'clear') {
                        fetch(`${SERVER_URL}/clear`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ site: window.location.hostname })
                        }).catch(() => {});
                    }
                } catch (e) { }
            });

            ws.addEventListener('close', () => {
                console.log('RPC WS closed');
                window.RPC_WS_LOADER = null;
                if (hbInterval) clearInterval(hbInterval);
                setTimeout(connectWS, 3000);
            });

            ws.addEventListener('error', (e) => {
                console.error('RPC WS error', e);
            });
        } catch (e) {
            console.error('Failed to create WS', e);
            setTimeout(connectWS, 3000);
        }
    }

    connectWS();

    window.addEventListener('beforeunload', () => {
        try { if (ws) ws.close(); } catch (e) {}
        if (hbInterval) clearInterval(hbInterval);
    });
})();

