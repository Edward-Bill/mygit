import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import rpc from "discord-rich-presence";

const appidPath = path.join(process.cwd(), "appid");
let clientId = null;

try {
    clientId = fs.readFileSync(appidPath, "utf8").trim();
//    console.log("Loaded clientId:", clientId);
} catch (err) {
    console.error("Failed to read appid:", err);
    process.exit(1);
}

let discord = null;

function connectDiscord() {
    try {
        discord = rpc(clientId);
        console.log("Connected to Discord RPC socket");
    } catch (e) {
        discord = null;
        console.log("Discord RPC not available, retrying...");
    }
}

connectDiscord();

setInterval(() => {
    if (!discord) connectDiscord();
}, 5000);

const app = express();
app.use(bodyParser.json());

let lastChange = 0;

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

app.post("/update", (req, res) => {
    const now = Date.now();
    if (now - lastChange < 2000)
        return res.status(429).json({ ok: false, error: "Too many requests" });

    lastChange = now;
    const body = req.body;

    console.log("▶ Now playing:", body.title, "-", body.artist);

    const thumb = body.thumbnail.split(",")[1];
    const buttons = body.trackUrl
        ? [{ label: "Listen", url: `https://vk.com/audio${body.trackUrl}` }]
        : [];

    const data = {
        state: body.artist,
        details: body.title.length < 2 ? `  ${body.title}` : body.title,
        startTimestamp: Math.floor(body.startTime / 1000),
        endTimestamp: Math.floor(body.startTime / 1000) + body.duration,
        instance: true,
        type: 2,
        largeImageKey: thumb.length > 300 ? "default_image" : thumb,
        largeImageText: "VK RPC by exec4tble",
        buttons
    };

    if (discord) {
        try {
            discord.updatePresence(data);
        } catch (err) {
            console.log("⚠️ Error updating Discord RPC, resetting connection...");
            discord = null;
        }
    } else {
        console.log("Discord RPC not yet  connected");
    }

    res.json({ ok: true });
});

app.get("/getClient", (req, res) => {
    const filePath = path.join(process.cwd(), "rpc_client.js");
    if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "application/javascript");
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).send("// rpc_client.js not found");
    }
});

app.listen(3020, () => {
    console.log("Listening on http://127.0.0.1:3020 (CORS enabled)");
});

