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

    let lastAnime = null;

    setInterval(() => {
        if (!window.location.pathname.includes("/anime/")) return;

        let latestRaw = localStorage.getItem("latest-views");
        if (!latestRaw) return;

        let latestArr;
        try {
            latestArr = JSON.parse(latestRaw);
        } catch (e) {
            return;
        }
        if (!latestArr || !latestArr[0]) return;
        let anime = latestArr[0];

        const titleFromDom = (document.querySelector(".av_c a") && document.querySelector(".av_c a").innerText) || null;
        const episodeFromDom = (document.querySelector(".xw_f5") && document.querySelector(".xw_f5").innerText) || null;
        const thumbEl = document.querySelector(".cover__img");

        let data = {
            name: titleFromDom || (anime.media && anime.media.rus_name) || "Unknown",
            episode: episodeFromDom || "",
            thumbnail: "https://animelib.org/static/images/logo/al/icon-180.png?90c18ce9f2277660055a7645458936be",
            // thumbnail: (thumbEl && thumbEl.src) || (anime.media && anime.media.cover && anime.media.cover.default) || "default_image",
        };

        if (!lastAnime || lastAnime.name !== data.name || lastAnime.episode !== data.episode) {
            lastAnime = data;

            let imageKey = data.thumbnail;

            fetch(SERVER_URL + "/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    site: "animelib.org",
                    state: data.episode,
                    details: data.name,
                    name: data.name,
                    startTimestamp: Math.floor(Date.now() / 1000),
                    largeImageKey: imageKey,
                    largeImageText: "RPC by exec4tble",
                    type: 3,
                    instance: false,
                })
            }).catch(err => {
                try {
                    if (String(err).includes("CORS")) {
                        console.error("couldnt connect to server backend or CORS are disabled")
                        return
                    }
                } catch (e) { }
                console.error("RPC server error:", err)
            });
            console.log("Activity sent:", data.name);
        }
    }, 3000);
})();


