import { spawn, execSync } from "child_process";

const LARGE_IMAGES = {
    "aimp": "aimp",
    "spotify": "spotify",
    "vlc": "vlc",

    "vk.ru": "vk",
    "youtube.com": "youtube",
    "music.youtube.com": "youtube_music",
    "music.yandex.ru": "yandex_music"
};

function getLargeImageKey(player, url = "") {

    player = player.toLowerCase();

    if (player in LARGE_IMAGES)
        return LARGE_IMAGES[player];

    try {

        const host = new URL(url).hostname.toLowerCase();

        for (const domain in LARGE_IMAGES) {

            if (host === domain || host.endsWith("." + domain))
                return LARGE_IMAGES[domain];

        }

    } catch {}

    return "no_logo";
}

export function startLinuxPlayerctl({ getClient, appId }) {

    let basePresence = null;
    let playing = false;
    let timer = null;

    const client = getClient(appId);

    if (!client)
        return;

    const metadata = spawn("playerctl", [
      "metadata",
      "--follow",
      "--format",
      "{{playerName}}||{{xesam:title}}||{{xesam:artist}}||{{xesam:url}}||{{mpris:length}}"
    ]);

    metadata.stdout.on("data", data => {

        for (const line of data.toString().split(/\r?\n/)) {

            if (!line)
                continue;

            const [
                player,
                title,
                artist,
                url,
                length
            ] = line.split("||");

            const duration =
                Math.floor(Number(length) / 1000000);

            basePresence = {

                details: "by " + artist || "",
                name: title || "Unknown",
                state: `in ${player}`,
                type: 2,
                largeImageKey: getLargeImageKey(player, url),
                _length: duration
            };

            updatePresence();
        }
    });

    const status = spawn("playerctl", [
        "status",
        "--follow"
    ]);

    status.stdout.on("data", data => {

        playing =
            data.toString().trim() === "Playing";

        updatePresence();

        if (timer)
            clearInterval(timer);

        if (playing) {

            timer = setInterval(updatePresence, 5000);

        }
    });

    function updatePresence() {

        if (!basePresence)
            return;

        const payload = {
            ...basePresence
        };

        if (playing) {

            try {

                const pos = parseFloat(
                    execSync("playerctl position")
                        .toString()
                );

                const now = Math.floor(Date.now() / 1000);

                payload.startTimestamp =
                    now - Math.floor(pos);

                payload.endTimestamp =
                    payload.startTimestamp +
                    payload._length;

            } catch {}
        }

        else {

            payload.smallImageKey = "pause";

        }

        delete payload._length;

        client.updatePresence(payload);
    }
}
