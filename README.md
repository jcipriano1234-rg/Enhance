# 4K Video Enhancer — a Whop app

Upload a video → press one button → it comes back upscaled to 4K Ultra HD (3840×2160) → watch it in the app → download it and keep it.

Built with: Node.js + FFmpeg + SQLite on the backend, plain HTML/JS on the frontend, and the official Whop SDK for logins. Everything is $0.

This folder lives in **OneDrive**, so it is backed up and follows you across your PCs. Double-click **START.bat** to run it locally.

**How it works:** users open the app inside your Whop, their video uploads to your server, FFmpeg scales it to 4K with high-quality Lanczos resampling + sharpening, re-encodes it at a very high bitrate, and gives them a download that stays 4K. Videos are saved 12 hours, then auto-deleted.

---

## 1. Try it on your computer first (5 minutes)

**Easiest way — double-click `START.bat` in this folder.** It checks for Node.js and FFmpeg, installs them if missing, then starts the app and tells you to open http://localhost:3000.

Manual way if you prefer a terminal:
1. Install Node.js 22: https://nodejs.org (the "LTS" version).
2. Install FFmpeg: open PowerShell and run `winget install ffmpeg`, then close and reopen the terminal.
3. In a terminal inside this folder: `npm install`, then `npm run dev`.

Whichever way you run it, open http://localhost:3000. It uses **demo mode** (no Whop login needed locally): drop a video in, press "Make it 4K", wait, download.

---

## 2. Put it on the internet for $0 (Oracle Cloud free server)

Whop loads your app from a public URL, so you need the app on the internet. The best free server that can actually handle 4K video encoding is **Oracle Cloud's "Always Free" tier** — it gives you a powerful ARM computer (24 GB RAM) free forever.

### 2.1 Create the server
1. Sign up at https://cloud.oracle.com (it asks for a card to confirm you're real — it is NOT charged on the Always Free tier).
2. In the top left: **Create** → **Instance**.
3. Pick image **Ubuntu 24.04**.
4. Change the shape → **Ampere A1** → set **4 OCPUs** and **24 GB** memory.
5. Under Boot volume, change size to **200 GB** (free allowance).
6. Download the SSH keys it offers (keep the private `.key` file safe) → **Create**.
7. When it's running, click **Create public IP** (subnet details → VNIC → IPv4 addresses → reserve and attach a public IP).

### 2.2 Open the web ports
Console → Networking → Virtual Cloud Networks → your VCN → Security Lists → Add Ingress Rules:
- Port **80**, source **0.0.0.0/0**
- Port **443**, source **0.0.0.0/0**

### 2.3 Get a free domain
1. Make an account at https://www.duckdns.org (sign in with GitHub/Google, it's free).
2. Create a subdomain, e.g. `joseph4k.duckdns.org`. Copy your **token** on that page.

### 2.4 Set up the server
SSH in from your terminal:

```bash
ssh -i <yourprivatekey.key> ubuntu@<server-public-ip>
```

Then run the setup (paste the whole block once):

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt update
sudo apt install -y caddy ffmpeg nodejs git
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Keep your DuckDNS subdomain pointing at the server (auto-updates if IP changes):

```bash
echo "curl -s 'https://www.duckdns.org/update?domains=joseph4k&token=YOUR_TOKEN&ip=' >/dev/null" | crontab -
```

### 2.5 Upload the app
From your **Windows** terminal (run it in OneDrive or wherever this folder is):

```bash
scp -i <yourprivatekey.key> -r . ubuntu@<server-ip>:~/whop-4k-app
```

Then back on the **server**:

```bash
cd ~/whop-4k-app
npm install
cp .env.example .env
nano .env
```

For deployment, set at minimum:

```
PORT=3000
DEMO_MODE=
MAX_MB=800
MAX_DURATION_MIN=12
OUTPUT_TTL_HOURS=12
```

(Leave `WHOP_APP_ID` empty until you do the Whop step below. It is important that `DEMO_MODE` is empty on the server, so real Whop login is required.)

### 2.6 Make it run forever (auto-restart)

```bash
sudo tee /etc/systemd/system/whop4k.service >/dev/null <<'EOF'
[Unit]
Description=4K Enhancer
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/whop-4k-app
ExecStart=/usr/bin/node --env-file=.env server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now whop4k
```

### 2.7 Turn on HTTPS

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace everything in it with (use YOUR duckdns subdomain):

```
joseph4k.duckdns.org {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Wait ~1 minute and open `https://joseph4k.duckdns.org` in your browser — you should see the app (it will say "Open inside Whop", that's correct — Whop login happens on the next step).

---

## 3. Connect it to Whop (10 minutes)

1. Go to https://whop.com/dashboard → Developer.
2. Click **Create App** → name it "4K Video Enhancer" → upload any logo.
3. On the app page, set **Base URL** to `https://your-subdomain.duckdns.org`.
4. Copy the **App ID** (`app_XXXXX`). Back on your server:

```bash
cd ~/whop-4k-app
nano .env
```

```
WHOP_APP_ID=app_XXXXXXXXXXX
```

```bash
sudo systemctl restart whop4k
```

5. Back on the Whop dashboard → your app → **Views / Experience** → add an experience to a product of yours (or make a new product, free or paid — if you want to charge for the app, make the product paid and Whop handles all the payments).
6. Open that product as a customer → your app loads inside Whop and is now fully logged in + gated.

**Optional — lock it harder:** if you want the server to double-check that the person really paid (even direct API hits), add to `.env`:

```
WHOP_API_KEY=your_app_api_key
WHOP_ACCESS_RESOURCE_ID=prod_XXXXXXXX
```

Then only buyers/members of that product can use the app. Get these two values from the Whop dashboard (Product ID on your product page, API key in Developer settings).

---

## 4. Tweaks (all in `.env`, then `sudo systemctl restart whop4k`)

| What | Env | Default |
| --- | --- | --- |
| Max upload size | `MAX_MB` | 800 |
| Max video length | `MAX_DURATION_MIN` | 12 min |
| Videos waiting per user | `MAX_PENDING_PER_USER` | 2 |
| Auto-delete outputs after | `OUTPUT_TTL_HOURS` | 12 h |
| Speed estimate (Fast) | `EST_FACTOR_FAST` | 1.5× video length |
| Speed estimate (Ultra-Best) | `EST_FACTOR_BEST` | 4× video length |
| Speed estimate (120fps) | `EST_FACTOR_120` | 10× video length |
| Max video length in 120fps mode | `MAX_DURATION_MIN_120` | 5 min |
| Clarity strength | `CLARITY` | 0.6 |
| Sharpen strength | `SHARPEN` | 0.85 |
| Output resolution (short edge) | `TARGET_SHORT_EDGE` | 1080 |

Storage math: outputs ~0.5–1.5 GB per minute of video. With a 200 GB disk and 12-hour auto-delete, ~5–10 users per hour is comfortable. If you hit noise, lower `MAX_DURATION_MIN` or raise it later when you upgrade storage.

---

## 5. Quality notes (be honest with your users)

- **Cinematic look (on by default)** — proprietary color grade + sharpening recipe. Tunable with `CLARITY` / `SHARPEN` env values if it gets too crunchy. There's also a "cinematic" preset and "none" available.
- Output is **1080p** (short edge 1080; sources already above 1080 stay at their size, they just get the polish): H.264 + AAC MP4 with +faststart. `TARGET_SHORT_EDGE=2160` brings back 4K if you ever upgrade servers.
- **"4K 120fps" mode** uses real motion interpolation (frame blending with motion vectors, minterpolate) to turn any video into buttery 120fps, then upscales to 4K. Very slow — limited to short clips (default 2 minutes). Fast motion scenes can occasionally show slight interpolation artifacts; that's the physics of inventing frames, not a bug.
- A denoise pass is applied before upscaling, which cleans up TikTok-style compression noise so the result matches the clean "TikTok player" look instead of looking oversharpened.
- The upscaler is a high-quality mathematical rescale (Lanczos) + light sharpening — it won't invent detail that was never there (that needs expensive AI upscaling). What it does: your video becomes true 4K resolution at a very high bitrate, so on a 4K TV or phone it looks crisp, and platforms that favor 4K (TikTok/Reels/YouTube compression) treat it far better.
- Videos that are already 4K are not pointlessly re-encoded in Fast/Ultra modes — they're checked and passed through untouched.
- "4K Ultra-Best" uses a slower encoder at maximum quality (CRF 16); "4K Fast" is quicker with very good quality (CRF 18); "4K 120fps" is CRF 18 at 120fps.

## 6. If something breaks

- **START.bat closes instantly** → run it again and read the message, or run `npm run dev` in a terminal inside this folder to see the error.
- **Server not responding on my domain** → `sudo systemctl status whop4k` and `sudo systemctl status caddy` on the server.
- **App inside Whop stuck loading** → Base URL in Whop dashboard must be exactly your `https://…duckdns.org` (https, no trailing slash).
- **"Open inside Whop" message** → normal, it means the server is up but not opened through a Whop product page. Open it through Whop.
- **Encoding slow** → expected on a free server (see speed table above). Make sure the Oracle instance is the 4 OCPU/24 GB shape.
- **OneDrive syncing lots of traffic while using the app** → the app stores videos in its `data` folder. You can pause OneDrive sync while heavy tests run, or right-click the folder → "Free up space" when done. The app itself runs from your PC either way.
- **Oracle "reclaims" idle instances** → the free tier is meant to be used. Light traffic (Caddy health checks + real users) keeps it active. If it gets stopped, just restart from the Oracle console.
