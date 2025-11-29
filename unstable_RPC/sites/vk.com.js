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
                trackUrl: track[26].split(",")[0]
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
            track.thumbnail = track.thumbnail.length > 300 ? track.thumbnail : "default_image";

            const thumb = track.thumbnail.split(",")[1];
            const buttons = track.trackUrl
                ? [{ label: "Listen", url: `https://vk.com/audio${track.trackUrl}` }]
                : null;

            let imageKey = thumb;

            let data = {
                state: track.artist,
                details: track.title.length < 2 ? `  ${track.title}` : track.title,
                startTimestamp: Math.floor(track.startTime / 1000),
                endTimestamp: Math.floor(track.startTime / 1000) + Math.floor(track.duration),
                instance: true,
                type: 2,
                largeImageKey: imageKey,
                largeImageText: "RPC by exec4tble",
            };

            if (buttons) data.buttons = buttons;

            const payload = {
                site: "vk.com",
                state: track.artist,
                details: track.title.length < 2 ? `  ${track.title}` : track.title,
                startTimestamp: Math.floor(track.startTime / 1000),
                endTimestamp: Math.floor(track.startTime / 1000) + Math.floor(track.duration),
                instance: true,
                type: 2,
                largeImageKey: imageKey,
                largeImageText: "RPC by exec4tble",
            };
            if (buttons) payload.buttons = buttons;

            fetch(SERVER_URL + "/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }).catch(err => {
                if (toString(err).includes("CORS")) {
                    console.error("couldnt connect to server backend or CORS are disabled")
                    return
                }
                console.error("RPC server error:", err)
            });
            console.log("Track sent:", track);
        }
    }, 3000);
})();


