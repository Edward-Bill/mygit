// ==UserScript==
// @name         VK Music RPC
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  localhost RPC for VK Music
// @author       exec4tble
// @match        https://vk.com/*
// @grant        none
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';
    if (window.VKRPC) return

    window.VKRPC = true;

    const SERVER_URL = "http://127.0.0.1:3020";

    function decodeHtmlEntities(str) {
        const txt = document.createElement("textarea");
        txt.innerHTML = str;
        return txt.value;
    }

    function getTrack() {
        const userId = localStorage.getItem("userId");
        if (!userId) return null;

        const raw = localStorage.getItem(`audio_v20_track_${userId}`);
        if (!raw) return null;

        try {
            const track = JSON.parse(raw);
            return {
                title: decodeHtmlEntities(track[3]),
                artist: decodeHtmlEntities(track[4]),
                duration: track[5],
                startTime: Date.now(),
                thumbnail: track[14],
                trackUrl: track[26]
            };
        } catch (e) {
            return null;
        }
    }

    let lastTrack = null;

    setInterval(() => {
        let track = getTrack();
        if (!track) return;

        if (!lastTrack || lastTrack.title !== track.title || lastTrack.artist !== track.artist) {
            lastTrack = track;
            console.log("Track:", track);

            fetch(SERVER_URL + "/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(track)
            }).catch(err => {
                if (toString(err).includes("CORS")) {
                    console.error("couldnt connect to server backend or CORS are disabled")
                    return
                }
                console.error("RPC server error:", err)
            });
        }
    }, 3000);
})();


