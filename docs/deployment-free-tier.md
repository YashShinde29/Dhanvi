# Deploying Dhanvi on free tiers (Vercel + Render + Neon)

Dhanvi is two Next.js apps, a Fastify API, a BullMQ worker, PostgreSQL and Redis. Vercel can host only the two Next.js apps; the API, worker, database and Redis need other providers. This guide uses free plans wherever they exist.

| Piece | Where | Plan | Notes |
| --- | --- | --- | --- |
| `frontend/apps/user-web` (member app) | Vercel | Hobby (free) | Project 1 |
| `frontend/apps/admin-web` (admin portal) | Vercel | Hobby (free) | Project 2 |
| `backend/` (Fastify API) | Render | Free web service (Docker) | Spins down after 15 min idle; first request after that takes ~30–60 s |
| `backend/` (BullMQ worker, `node dist/worker.js`) | Render | Background Worker (paid, ~$7/mo) | Optional: without it, operators open/close auctions manually (see Step 2b) |
| PostgreSQL | Neon | Free | 0.5 GB, scales to zero when idle, no expiry (Render's free Postgres is deleted after 30 days, so don't use it) |
| Redis | Upstash | Free | BullMQ queues only; use the `rediss://` (TLS) URL |

Cost: ₹0 / $0 without the worker (≈$7/mo with it). Limitations of the free plans are listed at the end.

## How the pieces talk to each other

```
Browser ──► user-web.vercel.app ──/api/*──► dhanvi-api.onrender.com ──► Neon Postgres
Browser ──► admin-web.vercel.app ─/api/*──► dhanvi-api.onrender.com ──┘
Razorpay ────────────────────────────────► dhanvi-api.onrender.com/api/v1/payments/webhooks/razorpay
```

The API sets `HttpOnly; SameSite=Strict` auth cookies. A browser will not send those to a different site, so each Next.js app **proxies `/api/*` to the backend** (rewrite in `next.config.ts`, enabled by `API_PROXY_TARGET`). The browser only ever calls its own Vercel domain; the proxy forwards to Render. This is why each app's `NEXT_PUBLIC_API_URL` is set to **its own** Vercel URL in production (same origin), instead of the local `http://localhost:3002`.

## Prerequisites

- Code pushed to a GitHub repository (Vercel and Render deploy from GitHub). The repo root must be the `Dhanvi` folder (the one containing `docker-compose.yml`, `backend/`, `frontend/`).
- Accounts on [vercel.com](https://vercel.com), [render.com](https://render.com), [neon.tech](https://neon.tech) — all can sign in with GitHub.
- A random secret for `JWT_SIGNING_KEY` (at least 32 characters). Generate one:
  ```bash
  openssl rand -base64 48
  ```

Deploy in this order: database → backend → frontends, because each step needs a URL/secret from the previous one.

---

## Step 1 — Database (Neon)

1. Sign in to Neon → **New project**. Name `dhanvi`, region closest to your users (e.g. `ap-southeast-1` Singapore), Postgres version 17.
2. On the project dashboard click **Connect**, choose **Node.js / connection string**, and turn **Connection pooling OFF** (the migrator uses a session advisory lock and the API sets the session time zone, which a transaction pooler does not support). Copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:npg_xxxx@ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
3. Keep it for Step 2 (`DATABASE_URL`). Nothing else to do — on first start the API creates every schema and table from `backend/sql/baseline/` and `backend/sql/migrations/`.
4. Create a free Redis database on [Upstash](https://upstash.com) (region near Singapore) and copy its `rediss://…` URL for `REDIS_URL`.

## Step 2 — Backend API (Render)

1. Render dashboard → **New +** → **Web Service** → connect your GitHub repo.
2. Settings:
   - **Name**: `dhanvi-api` (your URL becomes `https://dhanvi-api.onrender.com`; adjust if taken)
   - **Region**: Singapore (closest to Neon `ap-southeast-1`)
   - **Language / Runtime**: **Docker**
   - **Root Directory**: `backend`
   - **Dockerfile Path**: `backend/Dockerfile`
   - **Instance type**: **Free**
3. **Environment variables** (Environment tab). Add these:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon string from Step 1 |
   | `REDIS_URL` | the Upstash `rediss://` URL from Step 1 |
   | `RUN_MIGRATIONS_ON_START` | `true` |
   | `JWT_SIGNING_KEY` | your generated 48-char secret |
   | `JWT_SECURE_COOKIES` | `true` |
   | `NODE_ENV` | `production` (enforces the 20–50 member policy) |
   | `PORT` | `3002` |
   | `FRONTEND_ORIGIN` | `https://dhanvi-user.vercel.app;https://dhanvi-admin.vercel.app` (fill in with your real Vercel URLs after Step 3; a placeholder is fine for now) |
   | `DHANVI_SEED_ADMIN_ENABLED` | `true` (first deploy only, see Step 4) |
   | `DHANVI_SEED_ADMIN_EMAIL` | your admin email |
   | `DHANVI_SEED_ADMIN_PASSWORD` | a strong password (min 8 chars, upper, lower, digit, special) |
   | `PAYMENTS_RAZORPAY_ENABLED` | `false` until you configure Razorpay (Step 6) |
   | `RAZORPAY_ENVIRONMENT` | `TEST` |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | leave empty until Step 6 |

4. **Health Check Path**: `/api/v1/health` (Settings → Health & Alerts).
5. Click **Deploy Web Service**. The first Docker build takes 2–4 minutes.
6. Verify: open `https://dhanvi-api.onrender.com/api/v1/health` → `{"status":"healthy","application":"Dhanvi API"}`. Check the **Logs** tab for "Created schema from 0000_baseline" (or "Adopted the existing database schema") without errors. Swagger is at `/swagger` unless `SWAGGER_ENABLED=false`.

## Step 2b — Background worker (BullMQ)

The worker opens auctions at their start time and runs the Going Once → Going Twice → Final Call → Finalizing sequence. Render
runs it as a **Background Worker** (a paid instance type): same repo, Root Directory `backend`, Docker, **Docker Command**
`node dist/worker.js`, and the same environment variables as the API except `RUN_MIGRATIONS_ON_START=false`.

Without a worker, set `AUCTION_AUTOMATION_ENABLED=false` on the API: organizers/admins then open and close each auction
manually from the auction screen, exactly as before the migration. Never run the worker without Redis.

## Step 3 — Frontends (Vercel, two projects)

Repeat this for both apps. Only the values in the table differ.

1. Vercel dashboard → **Add New… → Project** → import the GitHub repo.
2. **Root Directory**: click *Edit* and pick `frontend/apps/user-web` (or `frontend/apps/admin-web`). Leave **"Include files outside the root directory"** enabled — the app depends on `frontend/packages/*` via npm workspaces, and Vercel installs from the workspace root (`frontend/`) automatically.
3. **Framework Preset**: Next.js (auto-detected). Build command and output stay default. Node.js version: 20.x or later (Settings → General after the first deploy).
4. **Environment Variables** (all three environments):

   | Key | user-web | admin-web |
   | --- | --- | --- |
   | `API_PROXY_TARGET` | `https://dhanvi-api.onrender.com` | `https://dhanvi-api.onrender.com` |
   | `NEXT_PUBLIC_API_URL` | `https://<user-project>.vercel.app` | `https://<admin-project>.vercel.app` |
   | `NEXT_PUBLIC_APP_KIND` | `user` | `admin` |
   | `NEXT_PUBLIC_USER_APP_URL` | `https://<user-project>.vercel.app` | `https://<user-project>.vercel.app` |
   | `NEXT_PUBLIC_ADMIN_URL` | `https://<admin-project>.vercel.app` | `https://<admin-project>.vercel.app` |

   You don't know the final `.vercel.app` URLs until the project exists. Either pick the project names first (`dhanvi-user`, `dhanvi-admin` → `https://dhanvi-user.vercel.app`) or deploy once, note the URLs, fix the variables, and **Redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so every change needs a redeploy.
5. **Deploy**. Then open the URL and confirm the landing page loads.
6. Go back to Render and set `FRONTEND_ORIGIN` to the two real Vercel URLs (`;`-separated, no trailing slashes). Render restarts the API automatically.

## Step 4 — First admin login, then lock seeding

1. Open `https://<admin-project>.vercel.app/login` and sign in with `DHANVI_SEED_ADMIN_EMAIL` / `DHANVI_SEED_ADMIN_PASSWORD`. (If the API was idle, wait ~1 minute for Render to wake it and retry.)
2. In Render, set `DHANVI_SEED_ADMIN_ENABLED` to `false` and delete the seed email/password variables. Seeding is idempotent, but don't leave credentials lying in config.
3. Open the member app, register a normal user, log in, log out — this exercises the cookie proxy path end to end.

## Step 5 — Post-deploy checklist

- [ ] `GET /api/v1/health` and `/api/v1/health/ready` both return 200 on Render.
- [ ] Register + login + refresh works on user-web (check DevTools → Application → Cookies: cookies are on the `.vercel.app` host, `Secure`, `HttpOnly`).
- [ ] Admin login works on admin-web; organizer applications list loads.
- [ ] Cross-app links (member "Admin" redirect → admin portal, admin "Member app" link) point at the right domains.
- [ ] `DHANVI_SEED_ADMIN_ENABLED=false`.
- [ ] Vercel: **Settings → Git → Production Branch** is `main` so pushes auto-deploy. Render auto-deploys on push by default.

## Step 6 — Optional: Razorpay (TEST mode)

The code only supports Razorpay **test** mode (a DB check constraint enforces `Environment = 'TEST'`). To enable it:

1. Razorpay dashboard (Test Mode) → API Keys → generate. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on Render.
2. Webhooks → add `https://dhanvi-api.onrender.com/api/v1/payments/webhooks/razorpay` (the Render URL directly, **not** the Vercel proxy). Set a secret and copy it to `RAZORPAY_WEBHOOK_SECRET`.
3. Set `PAYMENTS_RAZORPAY_ENABLED=true`. Render restarts.
4. Note: while the free API is asleep, a webhook can hit a cold start. Razorpay retries failed deliveries, so this is tolerable for testing but not for real money.

## Redeploying after code changes

- Push to `main` → Vercel rebuilds both apps and Render rebuilds the API automatically.
- New SQL migrations in `backend/sql/migrations/` are applied on API start because `RUN_MIGRATIONS_ON_START=true`.
- Changing any `NEXT_PUBLIC_*` variable requires a Vercel **Redeploy** (build-time values).

## Free-tier limitations (know before you rely on this)

- **Render free spins the API down after 15 minutes of no traffic.** The next request waits 30–60 s. Users will see a slow first load; Razorpay webhooks may hit a cold start. Paid Render starter ($7/mo) removes this. A free "keep-alive" cron pinging `/api/v1/health` every 10 min from [cron-job.org](https://cron-job.org) works but violates the spirit of the free plan; use at your discretion.
- **Render free has 512 MB RAM.** The Node API fits comfortably for a pilot.
- **Neon free**: 0.5 GB storage, compute scales to zero after 5 min idle (adds ~0.5 s on wake), 1 project. Ample for a pilot.
- **Vercel Hobby**: non-commercial use only per Vercel's terms; 100 GB bandwidth/month. If Dhanvi handles real money for a real community, move to Vercel Pro ($20/mo) or self-host the frontends too.
- **No custom domain in this setup.** With a domain you could put everything under one parent domain (`app.`, `admin.`, `api.`) and drop the proxy, but that isn't required.
- **Email is not sent.** Password-reset requests are only logged; forgot-password won't deliver a mail until an email provider is added (notifications are out of scope for now).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Login "succeeds" but you're immediately logged out / every call 401 | Cookies aren't reaching the API. Confirm each app's `NEXT_PUBLIC_API_URL` is its own Vercel URL (not the Render URL) and `API_PROXY_TARGET` is set on Vercel; redeploy. |
| CORS error in console | You bypassed the proxy (absolute API URL). Either use the relative URL or add the exact Vercel origin to `FRONTEND_ORIGIN`. |
| `Invalid environment configuration: DATABASE_URL …` in Render logs | `DATABASE_URL` (and `JWT_SIGNING_KEY`, ≥32 chars) must be set on the service. |
| Neon connection refused / SSL error | Ensure the URL ends with `?sslmode=require` and you copied the **direct** (non-pooled) endpoint. |
| Render build fails on `npm ci` | Root Directory must be `backend` (so `package.json` and `package-lock.json` are at the Docker build root). |
| Auctions never open or close automatically | The worker is not running or `REDIS_URL` is wrong; check the worker logs, or set `AUCTION_AUTOMATION_ENABLED=false` and operate auctions manually. |
| Vercel build can't find `@dhanvi/ui` etc. | "Include files outside the root directory" was turned off, or Root Directory points at the repo root instead of `frontend/apps/<app>`. |
| First request after a while takes a minute | Render free cold start. Expected. |
