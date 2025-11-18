// ==UserScript==
// @name         VK Music RPC Loader
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Load VK Music RPC from local server
// @author       exec4tble
// @match        https://vk.com/*
// @grant        none
// @connect      localhost
// ==/UserScript==

(function () {
    if (window.VKRPC_LOADER) return;
    window.VKRPC_LOADER = false;

    const SERVER_URL = "http://127.0.0.1:3020/getClient";

    function loadClient() {
        fetch(SERVER_URL)
            .then(r => r.text())
            .then(code => {
            const script = document.createElement("script");
            script.textContent = code;
            document.head.appendChild(script);
            console.log("VKRPC loaded from local server");
            window.VKRPC_LOADER = true;
        })
            .catch(err => {
            console.error("Failed to load VKRPC:", err)
            console.log("Reloading...")
            window.VKRPC_LOADER = false;
        });
    };

    setInterval(()=> {
        if (!window.VKRPC_LOADER) {
            loadClient();
        }
    }, 2000);
})();

