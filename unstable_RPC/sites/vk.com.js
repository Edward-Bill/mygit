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

        const raw = localStorage.getItem(`audio_v21_track_${userId}`);
        if (!raw) return null;

        const sliderRoot = document.querySelector(
            '[data-testid="audioplayerplaybackbody-progressbar"]'
            //'[data-testid="audio-player-block-progress-bar"]'
        ) || null;

        let sliderValue = sliderRoot ? sliderRoot.querySelectorAll('[role="slider"]:not([aria-readonly="true"])')[1].getAttribute('aria-valuenow') : null;

        try {
            const track = JSON.parse(raw);
            return {
                title: decodeHtmlEntities(track[3]),
                artist: decodeHtmlEntities(track[4]),
                duration: track[5],
                startTime: Date.now(),
                thumbnail: track[14],
                trackUrl: track[26].split(",")[0],
                sliderValue: sliderValue || null
            };
        } catch (e) {
            return null;
        }
    }

    let lastTrack = null;
    let basePayload = null;
    let lastIsPlaying = null;

    setInterval(() => {
        let track = getTrack();
        if (!track) return;

        const playingRaw = localStorage.getItem('audio_playing');
        const isPlaying = playingRaw === 'true' || playingRaw === '1';

        if (!lastTrack || lastTrack.title !== track.title || lastTrack.artist !== track.artist) {
            lastTrack = track;
            lastIsPlaying = null;
            track.thumbnail = track.thumbnail.length > 300 ? track.thumbnail : "default_image";

            const thumb = track.thumbnail.split(",")[1];
            const buttons = track.trackUrl
                ? [{ label: "Listen", url: `https://vk.com/audio${track.trackUrl}` }]
                : null;
            const url = track.trackUrl ? `https://vk.com/audio${track.trackUrl}` : null;

            let imageKey = thumb;

            basePayload = {
                site: "vk.com",
                name: track.title.length < 2 ? `  ${track.title}` : track.title,
                details: `by ${track.artist}`,
                state: "/home/git/unstable.Music",
                instance: true,
                type: 2,
                largeImageKey: imageKey,
                instance: true,
            };
            if (buttons) basePayload.buttons = buttons;
            if (url) basePayload.url = url;
        }

        if (!basePayload) return;

        let dur = Math.floor(Number(track.duration)) || 0;

        let position = 0;
        const slider = Number(track.sliderValue);
        if (!isNaN(slider) && slider > 0 && dur > 0) {
            position = (dur * slider / 100);
        } else if (track.startTime) {
            position = Math.floor((Date.now() - track.startTime) / 1000);
            if (position < 0) position = 0;
        }

        function sendUpdate(payload) {
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
        }

        let payload = Object.assign({}, basePayload);
        if (isPlaying && dur > 0) {
            const now = Math.floor(Date.now() / 1000);
            const start = Math.floor(now - position);
            payload.startTimestamp = start;
            payload.endTimestamp = Math.floor(start + dur);
            // console.log("timestamps (now, start, end):", now, start, start + dur);

            sendUpdate(payload);
            lastIsPlaying = true;
        } else {
            if (lastIsPlaying !== false) {
                payload.smallImageKey = "pause";
                delete payload.startTimestamp;
                delete payload.endTimestamp;
                sendUpdate(payload);
                lastIsPlaying = false;
            }
        }
    }, 4000);
})();


