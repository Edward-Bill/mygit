// ==UserScript==
// @name         All the RPCs Loader
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Loads RPC from local server
// @author       exec4tble
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @sandbox JavaScript
// ==/UserScript==

(function () {
    if (window.top !== window.self) return;
    if (window.RPC_WS_LOADER) return;
    window.RPC_WS_LOADER = null;

    const SERVER_URL = "http://127.0.0.1:3020";
    const WS_URL = "ws://localhost:3020/ws";
    let ws = null;
    let hbInterval = null;

    function request(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
                    }
                },
                onerror: reject,
                ontimeout: reject
            });
        });
    }

    function getSiteName() {
        const hostname = window.location.hostname;
        return hostname === "vk.ru" ? "vk.com" : hostname;
    }

    window.addEventListener("message", event => {
        if (event.origin !== window.location.origin) return;

        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            return;
        }

        if (!message || message.type !== "__UNSTABLE_RPC_UPDATE__" || !message.payload) return;

        request({
            method: "POST",
            url: `${SERVER_URL}/update`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(message.payload)
        }).catch(error => {
            console.error("RPC server error:", error);
        });
    });

    function loadClient() {
        request({
            method: "GET",
            url: `${SERVER_URL}/getClient?name=${encodeURIComponent(getSiteName())}`
        })
            .then(response => {
                const script = document.createElement("script");
                script.textContent = response.responseText;
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
                const siteName = getSiteName();
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
                        request({
                            method: 'POST',
                            url: `${SERVER_URL}/clear`,
                            headers: { 'Content-Type': 'application/json' },
                            data: JSON.stringify({ site: window.location.hostname })
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
