# Deploying the demo to Render (free)

This gives you a public URL like `https://autocommunity.onrender.com` that works on phones and laptops.
You need **one free Render account**. The blueprint (`render.yaml`) creates three things:

| Resource | What it runs | Free-plan limits |
|---|---|---|
| Web service `autocommunity` | Website **and** API in one container (`infra/render/start.sh`) | 512 MB RAM. **Sleeps after 15 min without visits**; the first visit after that takes ~30–60 s to wake up |
| Postgres `autocommunity-db` | Database with PostGIS. Uploaded photos are stored here too | **Expires 30 days after creation** unless you upgrade (Render's rule for free databases) |
| Key Value `autocommunity-redis` | Rate limits and sessions | Not persisted; that's fine |

## Steps (about 10 minutes, most of it waiting)

1. Open **https://render.com/deploy?repo=https://github.com/Maquldar/autocommunity**
2. Sign up / log in. Choosing **"GitHub"** is easiest. If Render asks for access to your repositories, allow access to `autocommunity`.
3. Render shows the blueprint with the 3 resources. Click **Deploy Blueprint** (Apply). You don't need to fill anything in: secrets are generated automatically.
4. Wait for the `autocommunity` service to show **Live**. The first build takes ~5–10 minutes. On first start it creates the tables and loads the demo drivers.
5. Open the service URL shown at the top of the service page.

## Logging in on the demo

- **Demo user:** phone `+7 700 000 00 02`. Or use any `+7` number to register a new account.
- There's no SMS provider, so the **code is shown on the login screen** (`DEMO_MODE=true`). Anyone with the link can log in. **Do not use it for real users or real data.**
- To test on your phone: open the URL in Safari/Chrome, then "Add to Home Screen". It runs full-screen like an app.

## Updating

Every push to `main` redeploys automatically. Data is kept; the demo seed runs only when the database is empty.

## Going beyond the demo (not done)

- Real SMS: set `SMS_PROVIDER=twilio`, the `TWILIO_*` variables and `DEMO_MODE=false`.
- Durable file storage: `STORAGE_DRIVER=s3` with Cloudflare R2 credentials (the CDN must send `X-Content-Type-Options: nosniff`).
- A paid instance (or splitting web and API) for more than 512 MB and no sleeping.

## Troubleshooting

- **Build fails at `pnpm install`:** check the build log. The build uses `npx pnpm@10.0.0`, so Render needs outbound access to npm (it has it by default).
- **"Error: ... ECONNREFUSED 127.0.0.1:4000" lines in the log right after a start:** normal. The website comes up a few seconds before the API.
- **Login says "too many attempts":** OTP limits are per phone and per IP. Wait an hour, or use another `+7` number.

What was verified before shipping this: the exact build and start scripts were run locally with Render's environment (production mode, demo mode, Postgres file storage, no `.env` files). The full Playwright suite passed against it (24/24). Render itself was **not** tested from here (no account in the build environment), so the first real deploy is the final check. Watch the build log.
