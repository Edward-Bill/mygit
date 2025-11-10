import express from "express";
import bodyParser from "body-parser";
import rpc from "discord-rich-presence";

const clientId = "1296764051468189717";
const discord = rpc(clientId);

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

	discord.updatePresence(data);
	res.json({ ok: true });
});

app.listen(3020, () => {
	console.log("Listening on http://127.0.0.1:3020 (CORS enabled)");
});

