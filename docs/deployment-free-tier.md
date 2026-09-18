# Deploying Dhanvi on free tiers (Vercel + Render + Neon)

Dhanvi is three deployables plus a database. Vercel can host only the two Next.js apps; the .NET API and PostgreSQL need other providers. This guide uses free plans for everything.

| Piece | Where | Plan | Notes |
| --- | --- | --- | --- |
| `apps/user-web` (member app) | Vercel | Hobby (free) | Project 1 |
| `apps/admin-web` (admin portal) | Vercel | Hobby (free) | Project 2 |
| `backend/` (.NET 10 API) | Render | Free web service (Docker) | Spins down after 15 min idle; first request after that takes ~30–60 s |
| PostgreSQL | Neon | Free | 0.5 GB, scales to zero when idle, no expiry (Render's free Postgres is deleted after 30 days, so don't use it) |

Cost: ₹0 / $0. Limitations of the free plans are listed at the end.

## How the pieces talk to each other

```
Browser ──► user-web.vercel.app ──/api/*──► dhanvi-api.onrender.com ──► Neon Postgres
Browser ──► admin-web.vercel.app ─/api/*──► dhanvi-api.onrender.com ──┘
Razorpay ────────────────────────────────► dhanvi-api.onrender.com/api/v1/payments/webhooks/razorpay
```

The API sets `HttpOnly; SameSite=Strict` auth cookies. A browser will not send those to a different site, so each Next.js app **proxies `/api/*` to the backend** (rewrite in `next.config.ts`, enabled by `API_PROXY_TARGET`). The browser only ever calls its own Vercel domain; the proxy forwards to Render. This is why `NEXT_PUBLIC_API_BASE_URL` is set to the relative value `/api/v1` in production.

## Prerequisites

- Code pushed to a GitHub repository (Vercel and Render deploy from GitHub). The repo root must be the `Dhanvi` folder (the one containing `package.json`, `backend/`, `apps/`).
- Accounts on [vercel.com](https://vercel.com), [render.com](https://render.com), [neon.tech](https://neon.tech) — all can sign in with GitHub.
- A random secret for `JWT_SIGNING_KEY` (at least 32 characters). Generate one:
  ```bash
  openssl rand -base64 48
  ```

Deploy in this order: database → backend → frontends, because each step needs a URL/secret from the previous one.

---

## Step 1 — Database (Neon)

1. Sign in to Neon → **New project**. Name `dhanvi`, region closest to your users (e.g. `ap-southeast-1` Singapore), Postgres version 17.
2. On the project dashboard click **Connect**. Choose **.NET** in the dropdown, and turn **Connection pooling OFF** (EF Core migrations should run against the direct endpoint). Copy the connection string. It looks like:
   ```
   Host=ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech;Database=neondb;Username=neondb_owner;Password=npg_xxxx;SSL Mode=Require;Channel Binding=Require
   ```
3. Keep it for Step 2 (`ConnectionStrings__DefaultConnection`). Nothing else to do — the API creates all schemas and tables from the checked-in migrations on first start.

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
   | `ConnectionStrings__DefaultConnection` | the Neon string from Step 1 |
   | `Database__ApplyMigrations` | `true` |
   | `Jwt__SigningKey` | your generated 48-char secret |
   | `Jwt__SecureCookies` | `true` |
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ASPNETCORE_URLS` | `http://+:8080` |
   | `PORT` | `8080` |
   | `Frontend__Origin` | `https://dhanvi-user.vercel.app;https://dhanvi-admin.vercel.app` (fill in with your real Vercel URLs after Step 3; a placeholder is fine for now) |
   | `DHANVI_SEED_ADMIN_ENABLED` | `true` (first deploy only, see Step 4) |
   | `DHANVI_SEED_ADMIN_EMAIL` | your admin email |
   | `DHANVI_SEED_ADMIN_PASSWORD` | a strong password (min 8 chars, upper, lower, digit, special) |
   | `Payments__Razorpay__Enabled` | `false` until you configure Razorpay (Step 6) |
   | `RAZORPAY_ENVIRONMENT` | `TEST` |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | leave empty until Step 6 |

4. **Health Check Path**: `/api/v1/health` (Settings → Health & Alerts).
5. Click **Deploy Web Service**. The first Docker build takes 5–10 minutes (restores and publishes .NET 10).
6. Verify: open `https://dhanvi-api.onrender.com/api/v1/health` → `{"status":"healthy","application":"Dhanvi API"}`. Check the **Logs** tab for "Applying migrations" without errors. Swagger is at `/swagger`.

## Step 3 — Frontends (Vercel, two projects)

Repeat this for both apps. Only the values in the table differ.

1. Vercel dashboard → **Add New… → Project** → import the GitHub repo.
2. **Root Directory**: click *Edit* and pick `apps/user-web` (or `apps/admin-web`). Leave **"Include files outside the root directory"** enabled — the app depends on `packages/*` via npm workspaces, and Vercel installs from the repo root automatically.
3. **Framework Preset**: Next.js (auto-detected). Build command and output stay default. Node.js version: 20.x or later (Settings → General after the first deploy).
4. **Environment Variables** (all three environments):

   | Key | user-web | admin-web |
   | --- | --- | --- |
   | `API_PROXY_TARGET` | `https://dhanvi-api.onrender.com` | `https://dhanvi-api.onrender.com` |
   | `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` | `/api/v1` |
   | `NEXT_PUBLIC_APP_KIND` | `user` | `admin` |
   | `NEXT_PUBLIC_USER_APP_URL` | `https://<user-project>.vercel.app` | `https://<user-project>.vercel.app` |
   | `NEXT_PUBLIC_ADMIN_URL` | `https://<admin-project>.vercel.app` | `https://<admin-project>.vercel.app` |

   You don't know the final `.vercel.app` URLs until the project exists. Either pick the project names first (`dhanvi-user`, `dhanvi-admin` → `https://dhanvi-user.vercel.app`) or deploy once, note the URLs, fix the variables, and **Redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so every change needs a redeploy.
5. **Deploy**. Then open the URL and confirm the landing page loads.
6. Go back to Render and set `Frontend__Origin` to the two real Vercel URLs (`;`-separated, no trailing slashes). Render restarts the API automatically.

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
3. Set `Payments__Razorpay__Enabled=true`. Render restarts.
4. Note: while the free API is asleep, a webhook can hit a cold start. Razorpay retries failed deliveries, so this is tolerable for testing but not for real money.

## Redeploying after code changes

- Push to `main` → Vercel rebuilds both apps and Render rebuilds the API automatically.
- New EF Core migrations are applied on API start because `Database__ApplyMigrations=true`.
- Changing any `NEXT_PUBLIC_*` variable requires a Vercel **Redeploy** (build-time values).

## Free-tier limitations (know before you rely on this)

- **Render free spins the API down after 15 minutes of no traffic.** The next request waits 30–60 s. Users will see a slow first load; Razorpay webhooks may hit a cold start. Paid Render starter ($7/mo) removes this. A free "keep-alive" cron pinging `/api/v1/health` every 10 min from [cron-job.org](https://cron-job.org) works but violates the spirit of the free plan; use at your discretion.
- **Render free has 512 MB RAM.** The .NET API fits, but memory-heavy operations under load can OOM-restart it.
- **Neon free**: 0.5 GB storage, compute scales to zero after 5 min idle (adds ~0.5 s on wake), 1 project. Ample for a pilot.
- **Vercel Hobby**: non-commercial use only per Vercel's terms; 100 GB bandwidth/month. If Dhanvi handles real money for a real community, move to Vercel Pro ($20/mo) or self-host the frontends too.
- **No custom domain in this setup.** With a domain you could put everything under one parent domain (`app.`, `admin.`, `api.`) and drop the proxy, but that isn't required.
- **Email is not sent.** The development `IEmailSender` only logs; forgot-password won't deliver a mail until a real sender is implemented (Resend has a free tier — 3,000 mails/month).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Login "succeeds" but you're immediately logged out / every call 401 | Cookies aren't reaching the API. Confirm `NEXT_PUBLIC_API_BASE_URL=/api/v1` (relative) and `API_PROXY_TARGET` is set on Vercel; redeploy. |
| CORS error in console | You bypassed the proxy (absolute API URL). Either use the relative URL or add the exact Vercel origin to `Frontend__Origin`. |
| `ConnectionStrings:DefaultConnection is required` in Render logs | Env var name must have a double underscore: `ConnectionStrings__DefaultConnection`. |
| Neon connection refused / SSL error | Ensure the string contains `SSL Mode=Require` and you copied the **direct** (non-pooled) endpoint. |
| Render build fails on `dotnet restore` | Root Directory must be `backend` (so `Dhanvi.sln` is at the Docker build root). |
| Vercel build can't find `@dhanvi/ui` etc. | "Include files outside the root directory" was turned off, or Root Directory points at the repo root instead of `apps/<app>`. |
| First request after a while takes a minute | Render free cold start. Expected. |
