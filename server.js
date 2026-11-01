/**
 * WhatsApp Nokia C2-01 Bridge Server — Cloud Edition
 * ====================================================
 * Runs 24/7 on Railway / Render / Fly.io
 * Connects to WhatsApp as a Multi-Device Linked Device.
 * Serves lightweight HTTP API for Nokia C2-01 J2ME MIDlet.
 *
 * Cloud extras vs local version:
 *   - /keepalive  endpoint (prevents free-tier sleep)
 *   - Session persistence to disk (survives container restarts)
 *   - /admin page to manage and re-pair from any browser
 *   - Configurable PORT from environment variable
 *   - Graceful shutdown saves session before exit
 */

"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const express = require("express");
const multer  = require("multer");
const sharp   = require("sharp");
const fs      = require("fs");
const path    = require("path");
const pino    = require("pino");
const http    = require("http");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 8080;
const AUTH_DIR   = path.join(__dirname, "auth_info_baileys");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const CACHE_DIR  = path.join(__dirname, "cache");
const MAX_MSGS   = 30;
const IMG_W      = 240;
const IMG_H      = 320;

// Self-ping URL for free-tier keep-alive (set to your Railway/Render URL)
// e.g. https://whatsapp-nokia.up.railway.app
const SELF_URL   = process.env.SELF_URL || "";

[AUTH_DIR, UPLOAD_DIR, CACHE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── State ─────────────────────────────────────────────────────────────────────
const app    = express();
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock         = null;
let isLinked     = false;
let pairingCode  = null;
let reconnecting = false;

const chatsCache    = new Map(); // jid -> {jid, name, lastMsg, lastTime}
const messagesCache = new Map(); // jid -> [{id,fromMe,text,hasImage,imgCacheId,timestamp}]
const startTime     = Date.now();

// ── WhatsApp Connection ───────────────────────────────────────────────────────
async function startWhatsApp() {
    if (reconnecting) return;
    reconnecting = true;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({
        auth:                state,
        printQRInTerminal:   false,
        logger:              pino({ level: "silent" }),
        markOnlineOnConnect: false,
        syncFullHistory:     false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        reconnecting = false;
        if (connection === "open") {
            console.log("[Bridge] ✅ WhatsApp linked.");
            isLinked    = true;
            pairingCode = null;
        } else if (connection === "close") {
            isLinked = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("[Bridge] ⚠️  Disconnected, code:", code);
            if (code !== DisconnectReason.loggedOut) {
                console.log("[Bridge] Reconnecting in 5s...");
                setTimeout(startWhatsApp, 5000);
            } else {
                console.log("[Bridge] Logged out. Use /admin to re-pair.");
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const m of messages) {
            if (!m.message) continue;
            await processMessage(m);
        }
    });
}

async function processMessage(m) {
    const jid = m.key.remoteJid;
    const msg = m.message;

    const text =
        msg.conversation                               ||
        msg.extendedTextMessage?.text                  ||
        msg.imageMessage?.caption                      ||
        (msg.imageMessage   ? "[Photo]"    : null)    ||
        (msg.videoMessage   ? "[Video]"    : null)    ||
        (msg.audioMessage   ? "[Voice]"    : null)    ||
        (msg.documentMessage ? "[Document]" : null)   ||
        "[Media]";

    const hasImage = !!msg.imageMessage;
    let imgCacheId = null;

    if (hasImage) {
        try {
            imgCacheId = m.key.id;
            const imgPath = path.join(CACHE_DIR, imgCacheId + ".jpg");
            if (!fs.existsSync(imgPath)) {
                const buf = await downloadMediaMessage(m, "buffer", {});
                await sharp(buf).resize(IMG_W, IMG_H, { fit: "inside" }).jpeg({ quality: 70 }).toFile(imgPath);
            }
        } catch (e) {
            console.error("[Bridge] Image error:", e.message);
        }
    }

    if (!messagesCache.has(jid)) messagesCache.set(jid, []);
    const list = messagesCache.get(jid);
    list.push({ id: m.key.id, fromMe: m.key.fromMe, text: clean(text), hasImage, imgCacheId, timestamp: m.messageTimestamp });
    if (list.length > MAX_MSGS) list.shift();

    chatsCache.set(jid, {
        jid, name: clean(m.pushName || jid.split("@")[0]),
        lastMsg: clean(text), lastTime: m.messageTimestamp
    });
}

startWhatsApp().catch(e => { console.error("[Bridge] Fatal:", e); process.exit(1); });

// ── Keep-Alive Self-Ping (prevents free-tier sleep) ───────────────────────────
if (SELF_URL) {
    setInterval(() => {
        try {
            const u = new URL(SELF_URL + "/keepalive");
            http.get({ hostname: u.hostname, path: u.pathname, port: u.port || 80 }, () => {});
        } catch (e) {}
    }, 4 * 60 * 1000); // every 4 minutes
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health / Keep-alive
app.get("/keepalive", (req, res) => res.json({ ok: true, uptime: Math.floor((Date.now() - startTime) / 1000) + "s" }));
app.get("/health",    (req, res) => res.json({ ok: true, linked: isLinked }));

// Admin Web UI (browser-based pairing control)
app.get("/admin", (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Nokia Bridge — Admin</title>
  <style>
    body { font-family: Arial, sans-serif; background: #111; color: #eee; padding: 20px; max-width: 600px; margin: auto; }
    h1 { color: #25D366; } 
    .card { background: #222; border-radius: 10px; padding: 20px; margin: 16px 0; }
    .status { font-size: 2em; }
    input { width: 100%; padding: 10px; font-size: 1.1em; border-radius: 6px; border: none; margin: 8px 0; box-sizing: border-box; }
    button { background: #25D366; color: #fff; padding: 12px 28px; font-size: 1em; border: none; border-radius: 6px; cursor: pointer; margin: 4px; }
    button:hover { background: #128C7E; }
    .code { font-size: 2.5em; letter-spacing: 8px; color: #25D366; font-weight: bold; text-align: center; padding: 16px; }
    .err { color: #ff4444; }
    pre { background: #333; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>📱 WhatsApp Nokia Bridge</h1>

  <div class="card">
    <b>Status:</b> <span id="status" class="status">${isLinked ? "✅ Linked" : "❌ Not Linked"}</span><br>
    <b>Uptime:</b> ${Math.floor((Date.now() - startTime) / 1000)}s<br>
    <b>Active Chats:</b> ${chatsCache.size}<br>
    <button onclick="refresh()">🔄 Refresh</button>
  </div>

  ${!isLinked ? `
  <div class="card">
    <h3>🔗 Link Your WhatsApp</h3>
    <p>Enter your phone number (with country code, no + sign):</p>
    <input type="tel" id="phone" placeholder="919876543210" />
    <button onclick="getCode()">Get 8-Digit Code</button>
    <div id="codeBox"></div>
  </div>` : `
  <div class="card">
    <h3>✅ WhatsApp is linked and running!</h3>
    <p>Your Nokia C2-01 can now connect. Open WhatsApp on the Nokia.</p>
    <button onclick="if(confirm('Logout and erase session?')) fetch('/admin/logout',{method:'POST'}).then(()=>location.reload())">🚪 Logout / Re-pair</button>
  </div>`}

  <div class="card">
    <h3>📋 Nokia App Settings</h3>
    <pre>Server URL to enter on Nokia:
${req.protocol}://${req.get("host")}</pre>
  </div>

  <script>
    function refresh() { location.reload(); }
    async function getCode() {
      const phone = document.getElementById("phone").value.replace(/\\D/g,"");
      if (phone.length < 7) { alert("Enter a valid phone number."); return; }
      document.getElementById("codeBox").innerHTML = "<p>Requesting...</p>";
      const r = await fetch("/pair?phone=" + phone);
      const t = await r.text();
      if (t.startsWith("CODE:")) {
        const code = t.slice(5);
        document.getElementById("codeBox").innerHTML =
          '<p>Enter this code in WhatsApp on your main phone:<br><b>Settings → Linked Devices → Link with phone number</b></p>' +
          '<div class="code">' + code + '</div>';
      } else {
        document.getElementById("codeBox").innerHTML = '<p class="err">' + t + '</p>';
      }
    }
  </script>
</body>
</html>`);
});

// Admin logout
app.post("/admin/logout", (req, res) => {
    try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR);
        isLinked = false;
        pairingCode = null;
        if (sock) { try { sock.end(); } catch(e){} }
        setTimeout(startWhatsApp, 1000);
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Status
app.get("/status", (req, res) => {
    res.set("Content-Type", "text/plain");
    res.send(isLinked ? "LINKED" : "UNLINKED");
});

// Pair
app.get("/pair", async (req, res) => {
    res.set("Content-Type", "text/plain");
    const phone = (req.query.phone || "").replace(/\D/g, "");
    if (!phone) return res.status(400).send("ERR:phone required");
    try {
        if (sock?.authState?.creds?.registered) return res.send("ALREADY_LINKED");
        const code = await sock.requestPairingCode(phone);
        const fmt  = code.length === 8 ? code.slice(0,4)+"-"+code.slice(4) : code;
        console.log("[Bridge] Pairing code:", fmt);
        pairingCode = fmt;
        res.send("CODE:" + fmt);
    } catch(e) {
        res.status(500).send("ERR:" + e.message);
    }
});

// Chat list
app.get("/chats", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    if (!chatsCache.size) return res.send("EMPTY");
    const sorted = [...chatsCache.values()].sort((a,b) => b.lastTime - a.lastTime);
    res.send(sorted.map(c => `${pipe(c.jid)}|${pipe(c.name)}|${pipe(c.lastMsg).substring(0,80)}`).join("\n"));
});

// Messages
app.get("/messages", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    const jid  = req.query.jid || "";
    const msgs = messagesCache.get(jid);
    if (!msgs || !msgs.length) return res.send("EMPTY");
    res.send(msgs.slice(-20).map(m =>
        `${m.fromMe?"ME":"THEM"}|${pipe(m.text).substring(0,200)}|${m.hasImage?"1":"0"}|${m.imgCacheId||""}`
    ).join("\n"));
});

// Send text
app.post("/send", async (req, res) => {
    res.set("Content-Type", "text/plain");
    const { jid, message } = req.body;
    if (!jid || !message) return res.status(400).send("ERR:missing params");
    try {
        await sock.sendMessage(jid, { text: message });
        if (!messagesCache.has(jid)) messagesCache.set(jid, []);
        messagesCache.get(jid).push({ id: Date.now()+"", fromMe:true, text:clean(message), hasImage:false, imgCacheId:null, timestamp: Math.floor(Date.now()/1000) });
        res.send("OK");
    } catch(e) { res.status(500).send("ERR:"+e.message); }
});

// Send photo
app.post("/send_photo", upload.single("photo"), async (req, res) => {
    res.set("Content-Type", "text/plain");
    const { jid, caption } = req.body;
    if (!jid || !req.file) return res.status(400).send("ERR:missing params");
    try {
        const buf = fs.readFileSync(req.file.path);
        await sock.sendMessage(jid, { image: buf, caption: caption || "" });
        fs.unlinkSync(req.file.path);
        res.send("OK");
    } catch(e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send("ERR:"+e.message);
    }
});

// View photo (resized for Nokia)
app.get("/view_photo", async (req, res) => {
    const id = req.query.id || "";
    if (!id) return res.status(400).send("ERR:id required");
    const imgPath = path.join(CACHE_DIR, id + ".jpg");
    if (!fs.existsSync(imgPath)) return res.status(404).send("NOT_FOUND");
    try {
        const buf = await sharp(imgPath).resize(IMG_W, IMG_H, { fit:"inside" }).jpeg({ quality:70 }).toBuffer();
        res.set("Content-Type", "image/jpeg");
        res.send(buf);
    } catch(e) { res.status(500).send("ERR:"+e.message); }
});

// Root redirect
app.get("/", (req, res) => res.redirect("/admin"));

// ── Helpers ───────────────────────────────────────────────────────────────────
const clean = s => (s||"").replace(/\r?\n/g," ").trim();
const pipe  = s => clean(s).replace(/\|/g," ");

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
    console.log("[Bridge] SIGTERM received. Saving session and shutting down.");
    if (sock) try { sock.end(); } catch(e) {}
    process.exit(0);
});
process.on("SIGINT", () => {
    console.log("[Bridge] SIGINT received. Saving session.");
    if (sock) try { sock.end(); } catch(e) {}
    process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║   WhatsApp Nokia C2-01 Bridge — CLOUD EDITION        ║");
    console.log(`║   Port: ${PORT}                                           ║`);
    console.log(`║   Admin: http://localhost:${PORT}/admin                    ║`);
    console.log("╚══════════════════════════════════════════════════════╝");
});
