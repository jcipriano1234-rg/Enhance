# Host for $0 — your PC as the server + Tailscale Funnel

Hugging Face ended free compute hosting (Docker/Gradio Spaces now cost money),
so the $0 plan is now: **the backend runs on your own PC** — the same machine
that has been encoding videos perfectly this whole time — and **Tailscale
Funnel** gives it a permanent public HTTPS address that Whop can embed.
No card, no KYC, no monthly bill.

## How it works

- Your PC already runs the app with `START.bat` (Node + ffmpeg).
- Tailscale Funnel opens a secure tunnel from the internet to that app.
- You get a URL like `https://yourpc-yourname.ts.net` that never changes,
  even if your home IP changes. Whop points at it.

## Honest limits

- **Your PC must be on** for the app to work. Sleeping PC = offline app.
  Fix below in Step 4 (power settings).
- **Home upload speed** is the ceiling: users' videos travel through your
  internet twice. Fine for your first 10-20 users; upgrade to a $26/month
  server (Hetzner) when it grows, or Oracle free tier if a card is available.
- The app uses ~2-4 GB RAM while encoding — keep gaming during encodes light.

## Step 1 — Tailscale account (no card)

Sign up at https://tailscale.com with email or Google. Free plan is enough —
Funnel is included.

## Step 2 — Install Tailscale on this PC

1. Download the Windows app from https://tailscale.com/download and sign in.
2. In the Tailscale admin site (login.tailscale.com), go to
   **DNS → Enable MagicDNS + HTTPS certificates** (both usually on already).

## Step 3 — Open the app to the internet

Open PowerShell (this PC, any folder) and run:

```
tailscale funnel --bg 3000
```

That's it. Your app is now live at:

```
https://YOURMACHINE-YOURTAILNET.ts.net
```

(exact URL is shown by the command output — copy it)
Landing page: that URL · App: that URL + `/app`

## Step 4 — Keep the PC alive

Windows Settings → System → Power:
- Screen off after 10 min: fine
- **Sleep: NEVER** (when plugged in)
- Windows Update restarts: set to "active hours" you're awake

## Step 5 — Connect to Whop

1. Whop → Developer → Apps → create app → copy `WHOP_API_KEY` and `WHOP_APP_ID`.
2. Whop → create your product (free for now) → attach the app → copy `prod_...`.
3. In the project folder, create `.env` with:

```
WHOP_API_KEY=...
WHOP_APP_ID=app_...
WHOP_ACCESS_RESOURCE_ID=prod_...
PORT=3000
```

(DEMO_MODE stays out — real Whop login only. START.bat uses this file.)

4. Whop app settings → **App URL**: `https://YOURMACHINE-YOURTAILNET.ts.net/app`

## Step 6 — Test the full loop

Open the app from inside your Whop product page → upload a real video →
download it. If that works, the product is live; flip the price to $20/month
whenever you're ready — nothing needs redeploying.

## Useful commands

```
tailscale funnel --bg 3000     # open the tunnel (run once per boot)
tailscale funnel --bg off 3000 # close it
tailscale status               # check it's connected
```

Add `tailscale funnel --bg 3000` to a startup task (or run it after
START.bat) so it survives reboots.

## Upgrade path (unchanged)

First users: this, $0. When the queue is regularly busy:
- ~250 users → Hetzner ~€26/month, 4 parallel encodes, `MAX_CONCURRENT=4`
- Or Oracle Always Free (4-core ARM) if a card ever becomes available
