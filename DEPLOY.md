# ☁️ Deploy to Railway — Step by Step (FREE, 24/7)

Railway gives **$5 free credit/month** — enough to run this bridge continuously.

---

## Prerequisites

- [Railway account](https://railway.app) (free, sign in with GitHub)
- [Git](https://git-scm.com/downloads) installed on your PC
- [Node.js 18+](https://nodejs.org) installed

---

## Method A — Railway CLI (Recommended, 5 minutes)

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
```

### 2. Login
```bash
railway login
```
A browser window opens — sign in with GitHub.

### 3. Go into the cloud folder
```bash
cd whatsapp-nokia-c2\cloud
```

### 4. Initialize & Deploy
```bash
railway init
railway up
```

Railway will:
- Detect Node.js automatically
- Install dependencies (`npm install`)
- Start the server (`npm start`)

### 5. Get your public URL
```bash
railway domain
```
It gives you a URL like `https://whatsapp-nokia-bridge-xxxx.up.railway.app`

### 6. Set SELF_URL (keeps app alive 24/7, prevents sleeping)
```bash
railway variables --set "SELF_URL=https://whatsapp-nokia-bridge-xxxx.up.railway.app"
```

### 7. Open Admin Panel in browser
```
https://whatsapp-nokia-bridge-xxxx.up.railway.app/admin
```
- Enter your phone number
- Get your 8-digit pairing code
- Approve on your smartphone

### 8. Update Nokia app with your cloud URL
On the Nokia C2-01, in the **Setup** screen, enter:
```
whatsapp-nokia-bridge-xxxx.up.railway.app:80
```
(remove `https://`, Nokia uses plain HTTP through port 80)

---

## Method B — Render (100% Free tier)

Render's free tier **sleeps after 15 minutes of inactivity** — the built-in self-ping in `server.js` prevents this automatically once `SELF_URL` is set.

### 1. Push to GitHub
```bash
cd whatsapp-nokia-c2\cloud
git init
git add .
git commit -m "WhatsApp Nokia Bridge"
git remote add origin https://github.com/YOUR_USERNAME/whatsapp-nokia-bridge.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Click **Create Web Service**

### 3. Add Environment Variable on Render
- Dashboard → your service → **Environment**
- Add: `SELF_URL` = `https://your-service-name.onrender.com`

### 4. Open Admin
```
https://your-service-name.onrender.com/admin
```

---

## Method C — Fly.io (Best — persistent session volume, always-on)

Fly.io free tier: 3 shared VMs + 3 GB persistent storage.

### 1. Install flyctl
```bash
# Windows PowerShell:
iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Login
```bash
fly auth login
```

### 3. Deploy
```bash
cd whatsapp-nokia-c2\cloud
fly launch --name whatsapp-nokia-bridge --region sin --no-deploy
fly volumes create wa_session --region sin --size 1
fly deploy
```

### 4. Get URL & open admin
```bash
fly open /admin
```

### Persistent Session
With Fly.io, the `auth_info_baileys/` folder is mounted as a **persistent volume** (`wa_session`). This means:
- Your WhatsApp session **survives redeploys, restarts, and crashes**.
- You only need to pair once — ever.

---

## After Deployment — Nokia App Setup

Once deployed, update the Nokia MIDlet's server address on first run:

| Platform | Nokia Server URL to enter |
|---|---|
| Railway | `whatsapp-nokia-xxxx.up.railway.app` (port 80) |
| Render | `your-name.onrender.com` (port 80) |
| Fly.io | `whatsapp-nokia-bridge.fly.dev` (port 80) |

> The Nokia app stores this in its built-in memory (RMS) after first save — you only enter it once.

---

## Monitoring

| URL | Purpose |
|---|---|
| `/admin` | Web dashboard — pair, view stats, logout |
| `/health` | JSON health check `{"ok":true,"linked":true}` |
| `/keepalive` | Uptime ping endpoint |
| `/status` | Nokia app endpoint — `LINKED` or `UNLINKED` |
