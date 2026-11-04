# 📱 WhatsApp J2ME Client for Nokia C2-01 (S40)

A lightweight Java ME (MIDP 2.0 / CLDC 1.1) WhatsApp client designed specifically for classic Nokia Series 40 phones like the **Nokia C2-01**.

---

## ⚡ How it Works
1. **Bridge Server:** Runs on your PC, Raspberry Pi, or cloud (Railway/Fly.io) using `@whiskeysockets/baileys`. Connects as a **Linked Device** to your WhatsApp.
2. **J2ME MIDlet Client (`WhatsApp.jar`):** Runs on your Nokia C2-01. Communicates with your bridge server over lightweight HTTP plain-text protocol.

---

## 📲 How to Install on Nokia C2-01
1. Download `WhatsApp.jar` and `WhatsApp.jad`.
2. Send both files to your Nokia C2-01 using **Bluetooth** or copy them to your **MicroSD Card**.
3. On your Nokia phone, go to **Applications** / **Memory Card** and click **WhatsApp**.
4. Grant network access permissions when prompted.

---

## 🔑 How to Pair with WhatsApp (Linked Device)
1. When you launch WhatsApp for the first time, go to **Settings**:
   - Enter your **Bridge Server URL** (e.g., `http://your-app.up.railway.app` or `http://192.168.1.10:8080`).
   - Enter your **Phone Number** with country code (e.g., `919876543210`).
   - Click **OK**.
2. On the **Link WhatsApp** screen, click **Get Code**.
3. You will see an 8-digit pairing code (e.g., `CODE: 7X89-2910`).
4. On your primary smartphone:
   - Open WhatsApp -> **Settings** -> **Linked Devices** -> **Link with phone number**.
   - Enter the 8-digit code shown on your Nokia screen!
5. Boom! Your chats will load on your Nokia C2-01!

---

## 📋 Features on Nokia C2-01:
- **Chat List:** View recent conversations with timestamps and unread message snippets.
- **Full Message View:** Last 20 messages with incoming & outgoing tags.
- **T9 Keypad Composition:** Fast message typing using physical keypad.
- **Synced Contacts:** Select contacts to start conversations directly.
- **RMS Memory:** Remembers your bridge server settings and phone number across reboots.
