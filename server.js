/**
 * WhatsApp Nokia C2-01 Bridge Server
 * ====================================
 * Connects to WhatsApp as a Multi-Device Linked Device.
 * Serves a lightweight HTTP API consumed by the Nokia C2-01 J2ME MIDlet.
 *
 * Endpoints:
 *   GET  /status          - Returns LINKED or UNLINKED
 *   GET  /pair?phone=     - Returns 8-digit pairing code
 *   GET  /chats           - Returns chat list as plain text (JID|NAME|LAST_MSG)
 *   GET  /messages?jid=   - Returns last 20 messages (SENDER|TEXT|HAS_IMG)
 *   POST /send            - Sends a text message (body: jid, message)
 *   POST /send_photo      - Sends a photo (multipart: jid, caption, photo file)
 *   GET  /view_photo?id=  - Returns JPEG resized to 240x320 for Nokia screen
 */

"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    proto
} = require("@whiskeysockets/baileys");

const express  = require("express");
const multer   = require("multer");
const sharp    = require("sharp");
const fs       = require("fs");
const path     = require("path");
const pino     = require("pino");

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT         = 8080;
const AUTH_DIR     = path.join(__dirname, "auth_info_baileys");
const UPLOAD_DIR   = path.join(__dirname, "uploads");
const CACHE_DIR    = path.join(__dirname, "cache");
const MAX_MESSAGES = 30;  // Messages kept per JID in memory cache
const IMG_WIDTH    = 240; // Nokia C2-01 screen width
const IMG_HEIGHT   = 320; // Nokia C2-01 screen height

// Ensure directories exist
[AUTH_DIR, UPLOAD_DIR, CACHE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── State ─────────────────────────────────────────────────────────────────────
const app   = express();
const upload = multer({ dest: UPLOAD_DIR });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock       = null;
let isLinked   = false;

// Map<jid, { jid, name, lastMsg, lastTime }>
const chatsCache = new Map();

// Map<jid, Array<{ id, fromMe, text, hasImage, imgCacheId, timestamp }>>
const messagesCache = new Map();

// Map<jid, { jid, name, phone }>
const contactsCache = new Map();
const CONTACTS_FILE = path.join(__dirname, "contacts.json");

function loadSavedContacts() {
    try {
        if (fs.existsSync(CONTACTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf-8"));
            data.forEach(c => contactsCache.set(c.jid, c));
        }
    } catch (e) {}
}
function saveContactsToFile() {
    try {
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify([...contactsCache.values()], null, 2));
    } catch (e) {}
}
loadSavedContacts();

// ── WhatsApp Connection ───────────────────────────────────────────────────────
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const logger = pino({ level: "silent" });

    sock = makeWASocket({
        auth:               state,
        printQRInTerminal:  false,
        logger:             logger,
        markOnlineOnConnect: false,
        // Reduce memory footprint for constrained environments
        syncFullHistory:    false
    });

    // Persist credentials on every update
    sock.ev.on("creds.update", saveCreds);

    // Contacts sync from WhatsApp
    sock.ev.on("contacts.upsert", (contacts) => {
        for (const c of contacts) {
            if (c.id && !c.id.includes("@g.us")) {
                const name = c.name || c.notify || c.verifiedName || c.id.split("@")[0];
                const phone = c.id.split("@")[0];
                contactsCache.set(c.id, { jid: c.id, name: sanitize(name), phone: phone });
            }
        }
        saveContactsToFile();
    });

    sock.ev.on("contacts.update", (updates) => {
        for (const u of updates) {
            if (u.id && contactsCache.has(u.id)) {
                const prev = contactsCache.get(u.id);
                if (u.name) prev.name = sanitize(u.name);
            }
        }
        saveContactsToFile();
    });

    // Connection lifecycle
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("[Bridge] WhatsApp linked successfully.");
            isLinked = true;
        } else if (connection === "close") {
            isLinked = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("[Bridge] Disconnected. Code:", code);
            if (code !== DisconnectReason.loggedOut && code !== 401 && code !== 408) {
                console.log("[Bridge] Reconnecting...");
                startWhatsApp();
            } else {
                console.log("[Bridge] Session reset (code: " + code + "). Ready for fresh pair.");
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    fs.mkdirSync(AUTH_DIR, { recursive: true });
                } catch(e) {}
                setTimeout(startWhatsApp, 2000);
            }
        }
    });

    // Incoming messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const m of messages) {
            if (!m.message) continue;

            const jid  = m.key.remoteJid;
            const msg  = m.message;

            // Extract text content
            const text =
                msg.conversation                          ||
                msg.extendedTextMessage?.text             ||
                msg.imageMessage?.caption                 ||
                msg.videoMessage?.caption                 ||
                (msg.imageMessage  ? "[Photo]"  : null)  ||
                (msg.videoMessage  ? "[Video]"  : null)  ||
                (msg.audioMessage  ? "[Audio]"  : null)  ||
                (msg.documentMessage ? "[Document]" : null) ||
                "[Media]";

            const hasImage = !!msg.imageMessage;
            let imgCacheId = null;

            // Download and cache image thumbnails for the Nokia
            if (hasImage) {
                try {
                    imgCacheId = m.key.id;
                    const imgPath = path.join(CACHE_DIR, imgCacheId + ".jpg");
                    if (!fs.existsSync(imgPath)) {
                        const buffer = await downloadMediaMessage(m, "buffer", {});
                        await sharp(buffer)
                            .resize(IMG_WIDTH, IMG_HEIGHT, { fit: "inside" })
                            .jpeg({ quality: 70 })
                            .toFile(imgPath);
                    }
                } catch (err) {
                    console.error("[Bridge] Image download error:", err.message);
                }
            }

            // Format timestamp to HH:mm
            const date = new Date(m.messageTimestamp * 1000);
            const timeStr = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
            const participantName = m.key.participant ? (m.pushName || m.key.participant.split('@')[0]) : '';

            // Push into messages cache (keep last MAX_MESSAGES)
            if (!messagesCache.has(jid)) messagesCache.set(jid, []);
            const msgList = messagesCache.get(jid);
            msgList.push({
                id:         m.key.id,
                fromMe:     m.key.fromMe,
                text:       text.replace(/\r?\n/g, " "),
                hasImage:   hasImage,
                imgCacheId: imgCacheId,
                timestamp:  m.messageTimestamp,
                timeStr:    timeStr,
                senderName: participantName
            });
            if (msgList.length > MAX_MESSAGES) msgList.shift();

            // Update chat list preview
            const pushName = m.pushName || jid.split("@")[0].replace(/[^a-zA-Z0-9 ]/g, "");
            chatsCache.set(jid, {
                jid:      jid,
                name:     pushName,
                lastMsg:  text.replace(/\r?\n/g, " "),
                lastTime: m.messageTimestamp,
                timeStr:  timeStr,
                isGroup:  jid.endsWith("@g.us") ? "1" : "0"
            });
        }
    });
}

// Start the WA connection immediately
startWhatsApp().catch(err => {
    console.error("[Bridge] Fatal startup error:", err);
    process.exit(1);
});

// ── HTTP Endpoints ────────────────────────────────────────────────────────────

/**
 * GET /status
 * Returns: "LINKED" or "UNLINKED"
 */
app.get("/status", (req, res) => {
    res.set("Content-Type", "text/plain");
    res.send(isLinked ? "LINKED" : "UNLINKED");
});

/**
 * GET /pair?phone=<E.164 number without +>
 * Returns: "CODE:XXXX-XXXX" or "ALREADY_LINKED" or "ERR:..."
 */
app.get("/pair", async (req, res) => {
    res.set("Content-Type", "text/plain");
    const phone = (req.query.phone || "").replace(/\D/g, "");
    if (!phone) return res.status(400).send("ERR:phone param required (digits only, country code first)");

    try {
        if (sock.authState.creds.registered) {
            return res.send("ALREADY_LINKED");
        }
        const code = await sock.requestPairingCode(phone);
        // Format as XXXX-XXXX for readability on small screen
        const formatted = code.length === 8 ? code.slice(0, 4) + "-" + code.slice(4) : code;
        console.log("[Bridge] Pairing code generated:", formatted);
        res.send("CODE:" + formatted);
    } catch (err) {
        console.error("[Bridge] Pair error:", err.message);
        res.status(500).send("ERR:" + err.message);
    }
});

/**
 * GET /contacts
 * Returns: List of contacts in format JID|NAME|PHONE
 */
app.get("/contacts", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    if (contactsCache.size === 0) return res.send("EMPTY");
    const sorted = [...contactsCache.values()].sort((a, b) => a.name.localeCompare(b.name));
    const lines = sorted.map(c => `${c.jid}|${c.name}|${c.phone || c.jid.split('@')[0]}`);
    res.send(lines.join("\n"));
});

/**
 * POST /add_contact
 * Body: name, phone
 * Saves contact and initializes a chat
 */
app.post("/add_contact", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).send("ERR:name and phone required");
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) return res.status(400).send("ERR:invalid phone number");
    const jid = `${digits}@s.whatsapp.net`;
    const cleanName = sanitize(name);
    contactsCache.set(jid, { jid: jid, name: cleanName, phone: digits });
    saveContactsToFile();

    // Also add to chat cache
    chatsCache.set(jid, {
        jid: jid,
        name: cleanName,
        lastMsg: "(Contact added)",
        lastTime: Math.floor(Date.now() / 1000),
        timeStr: "Now",
        isGroup: "0"
    });

    res.send(`OK|${jid}|${cleanName}`);
});

/**
 * GET /chats
 * Returns: Plain text lines, one per chat
 * Format per line: JID|NAME|LAST_MESSAGE|TIME|IS_GROUP
 */
app.get("/chats", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    if (chatsCache.size === 0) return res.send("EMPTY");

    // Sort by most recent first
    const sorted = [...chatsCache.values()].sort((a, b) => b.lastTime - a.lastTime);

    const lines = sorted.map(c => {
        const jid  = sanitize(c.jid);
        const name = sanitize(c.name);
        const last = sanitize(c.lastMsg).substring(0, 80);
        const time = c.timeStr || "";
        const isGrp = c.isGroup || "0";
        return `${jid}|${name}|${last}|${time}|${isGrp}`;
    });

    res.send(lines.join("\n"));
});

/**
 * GET /new_chat?phone=<digits>
 * Creates or selects a chat for the given phone number
 */
app.get("/new_chat", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    const phone = (req.query.phone || "").replace(/\D/g, "");
    if (!phone) return res.status(400).send("ERR:phone required");
    const jid = `${phone}@s.whatsapp.net`;
    if (!chatsCache.has(jid)) {
        chatsCache.set(jid, {
            jid: jid,
            name: `+${phone}`,
            lastMsg: "(New Conversation)",
            lastTime: Math.floor(Date.now() / 1000),
            timeStr: "Now",
            isGroup: "0"
        });
    }
    res.send(`OK|${jid}|+${phone}`);
});

/**
 * GET /messages?jid=<jid>
 * Returns: Plain text lines, one per message (last 20)
 * Format per line: SENDER|TEXT|HAS_IMG|IMG_ID|TIME|SENDER_NAME
 */
app.get("/messages", (req, res) => {
    res.set("Content-Type", "text/plain; charset=UTF-8");
    const jid = req.query.jid || "";
    const msgs = messagesCache.get(jid);

    if (!msgs || msgs.length === 0) return res.send("EMPTY");

    const lines = msgs.slice(-20).map(m => {
        const sender     = m.fromMe ? "ME" : "THEM";
        const text       = sanitize(m.text).substring(0, 200);
        const hasImg     = m.hasImage ? "1" : "0";
        const imgId      = m.imgCacheId || "";
        const time       = m.timeStr || "";
        const senderName = sanitize(m.senderName || "");
        return `${sender}|${text}|${hasImg}|${imgId}|${time}|${senderName}`;
    });

    res.send(lines.join("\n"));
});

/**
 * POST /send
 * Body: jid=<jid>&message=<text>
 * Returns: "OK" or "ERR:..."
 */
app.post("/send", async (req, res) => {
    res.set("Content-Type", "text/plain");
    const { jid, message } = req.body;

    if (!jid || !message) return res.status(400).send("ERR:jid and message required");

    try {
        await sock.sendMessage(jid, { text: message });

        // Mirror into local cache immediately so Nokia sees it
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        if (!messagesCache.has(jid)) messagesCache.set(jid, []);
        messagesCache.get(jid).push({
            id:         Date.now().toString(),
            fromMe:     true,
            text:       message.replace(/\r?\n/g, " "),
            hasImage:   false,
            imgCacheId: null,
            timestamp:  Math.floor(Date.now() / 1000),
            timeStr:    timeStr,
            senderName: ''
        });

        res.send("OK");
    } catch (err) {
        console.error("[Bridge] Send error:", err.message);
        res.status(500).send("ERR:" + err.message);
    }
});

/**
 * POST /send_photo
 * Multipart: jid=<jid>, caption=<text>, photo=<file>
 * Returns: "OK" or "ERR:..."
 */
app.post("/send_photo", upload.single("photo"), async (req, res) => {
    res.set("Content-Type", "text/plain");
    const jid     = req.body.jid;
    const caption = req.body.caption || "";

    if (!jid || !req.file) return res.status(400).send("ERR:jid and photo required");

    try {
        const buffer = fs.readFileSync(req.file.path);
        await sock.sendMessage(jid, { image: buffer, caption: caption });
        fs.unlinkSync(req.file.path); // Clean up temp file

        // Mirror message in cache
        if (!messagesCache.has(jid)) messagesCache.set(jid, []);
        messagesCache.get(jid).push({
            id:         Date.now().toString(),
            fromMe:     true,
            text:       caption || "[Photo]",
            hasImage:   false,
            imgCacheId: null,
            timestamp:  Math.floor(Date.now() / 1000)
        });

        res.send("OK");
    } catch (err) {
        console.error("[Bridge] Photo send error:", err.message);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send("ERR:" + err.message);
    }
});

/**
 * GET /view_photo?id=<imgCacheId>
 * Returns: JPEG image resized to max 240x320 for Nokia C2-01 display
 */
app.get("/view_photo", async (req, res) => {
    const id = req.query.id || "";
    if (!id) return res.status(400).send("ERR:id required");

    const imgPath = path.join(CACHE_DIR, id + ".jpg");
    if (!fs.existsSync(imgPath)) return res.status(404).send("NOT_FOUND");

    try {
        const resized = await sharp(imgPath)
            .resize(IMG_WIDTH, IMG_HEIGHT, { fit: "inside" })
            .jpeg({ quality: 70 })
            .toBuffer();

        res.set("Content-Type", "image/jpeg");
        res.send(resized);
    } catch (err) {
        res.status(500).send("ERR:" + err.message);
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
// Remove pipe characters that would break the Nokia parser
function sanitize(str) {
    return (str || "").replace(/\|/g, " ").replace(/\r?\n/g, " ").trim();
}

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   WhatsApp Nokia C2-01 Bridge Server             ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║   Listening on http://0.0.0.0:${PORT}               ║`);
    console.log("║                                                  ║");
    console.log("║   First run:                                     ║");
    console.log("║   1. Open WhatsApp app on Nokia C2-01            ║");
    console.log("║   2. Enter your phone number on pairing screen   ║");
    console.log("║   3. Note the 8-digit code shown on Nokia        ║");
    console.log("║   4. On your smartphone: WhatsApp > Settings >  ║");
    console.log("║      Linked Devices > Link with phone number     ║");
    console.log("║   5. Enter the 8-digit code                      ║");
    console.log("╚══════════════════════════════════════════════════╝");
});
