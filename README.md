# Dhanvi

Prompt 8 incoming Razorpay Test payments and their verification are documented in the [final Prompt 8 report](docs/prompt-8-verification.md). It supersedes older milestone statements below about payments and Ledger being deferred; payout execution remains deferred.

Dhanvi is a production-minded foundation for a community savings platform. The current milestone implements authentication, user accounts, platform roles, profiles, organizer application approval, and savings groups, activation, monthly schedules, and manual contribution tracking, and verifiable random/organizer-reserved selection through SELECTION_COMPLETED with a Fastify + TypeScript API, Next.js frontends and PostgreSQL. Auction bidding and calculated payout rights are implemented; financial execution, payments, real payouts, and ledger behavior remain deferred. See [Auction engine](docs/auction-engine.md). See [Groups and membership foundation](docs/groups-foundation.md) for rules, APIs, migration, concurrency, frontend pages, and operational details. See [Monthly cycles and contribution tracking](docs/cycles-and-contributions.md) for the activation transaction, timezone, idempotency, reversals, new APIs, and migration. See [Random and organizer-reserved selection](docs/random-and-reserved-selection.md) for the V1 algorithm, proof format, payout-right semantics, APIs, and migration.

## Architecture

> **Backend migrated to Fastify.** The API in `backend/` is Fastify + TypeScript on the same PostgreSQL schema, with Redis +
> BullMQ for durable background work. The former ASP.NET Core backend has been removed from the repository (it remains in
> git history). See [Fastify migration](docs/fastify-migration/README.md), the
> [parity checklist](docs/fastify-migration/parity-checklist.md) and the [cutover runbook](docs/fastify-migration/cutover-runbook.md).

The API exposes the same `/api/v1` routes, payloads and error codes as before. PostgreSQL remains the financial source of
truth (row locks, append-only triggers, NUMERIC money); Redis only carries BullMQ queues. Authentication uses a 15-minute JWT
access token and a rotating, SHA-256-hashed opaque refresh token, via bearer headers or HttpOnly SameSite cookies; backend
authorization remains the source of truth.

## Project layout

```
Dhanvi/
├── README.md · docker-compose.yml · .env.example
├── frontend/                     npm workspace (Next.js 16)
│   ├── package.json · tsconfig.base.json · eslint.config.mjs · tests/
│   ├── apps/user-web             member app      http://localhost:3000
│   ├── apps/admin-web            admin portal    http://localhost:3001
│   └── packages/                 api-client · auth · config · features · types · ui · utils
├── backend/                      Fastify API     http://localhost:3002
│   ├── package.json · tsconfig.json · Dockerfile
│   ├── sql/{baseline,migrations}
│   ├── src/server.ts             HTTP API (PORT=3002)
│   ├── src/worker.ts             BullMQ worker (no public port; processes Redis jobs)
│   ├── src/{app.ts,config,plugins,routes,features,queues,workers,services,infra,types,utils,scripts}
│   └── test/
├── docs/ · tools/ · assets/
```

Both web apps call the same backend: `NEXT_PUBLIC_API_URL=http://localhost:3002` (the API client appends `/api/v1`).

## Prerequisites

- Docker Desktop with Docker Compose
- Node.js 22.12+ (24 recommended) and npm 10+
- PostgreSQL 16+ and Redis 7 when not using Docker

## Configuration

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder values. Do not commit `.env`.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local PostgreSQL settings |
| `BACKEND_PORT`, `FRONTEND_PORT` | Host application ports (API 3002, member app 3000) |
| `JWT_SIGNING_KEY` | Random secret of at least 32 characters; use a secret manager in production |
| `DHANVI_SEED_ADMIN_ENABLED` | Set `true` only when intentionally creating the initial super admin |
| `DHANVI_SEED_ADMIN_EMAIL`, `DHANVI_SEED_ADMIN_PASSWORD` | Initial super-admin credentials when seeding is enabled |
| `FRONTEND_ORIGIN` | Browser origins allowed by the API (`;`-separated); defaults to both web apps |
| `ADMIN_PORT`, `USER_APP_URL`, `ADMIN_APP_URL` | Admin portal host port and the cross-app link URLs baked into each web app |
| `NEXT_PUBLIC_API_URL` | Backend origin used by both web apps (`http://localhost:3002`) |
| `REDIS_PORT` | Redis host port |
| `AUCTION_GOING_ONCE_SECONDS`, `AUCTION_GOING_TWICE_SECONDS`, `AUCTION_FINAL_WARNING_SECONDS` | Digital closing-sequence phase durations (default 30 s each) |
| `PAYMENTS_RAZORPAY_ENABLED`, `RAZORPAY_*` | Razorpay TEST mode credentials (backend only) |

The full backend variable list (pool size, sweep intervals, payouts, ledger policy) is in `backend/.env.example`.

Admin seeding is idempotent. After the first account is created, disable it and restart the API. Never use the example credentials in a shared or production environment.

## Run with Docker

```powershell
docker compose up --build
```

Open:

- Member web app: `http://localhost:3000`
- Admin portal: `http://localhost:3001`
- API health: `http://localhost:3002/api/v1/health`
- Swagger: `http://localhost:3002/swagger`

Compose starts PostgreSQL, Redis, the Fastify API (applies migrations and seeds on start), the BullMQ worker and both web
apps.

Stop the project while keeping database data:

```powershell
docker compose down
```

Only use `docker compose down -v` when you intentionally want to delete the local database volume.

## Implemented API

Authentication and profile:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/users/me`
- `PUT /api/v1/users/me`
- `PUT /api/v1/users/me/password`

Organizer workflow:

- `POST /api/v1/organizers/apply`
- `GET /api/v1/organizers/me`
- `GET /api/v1/admin/organizer-applications`
- `POST /api/v1/admin/organizer-applications/{applicationId}/approve`
- `POST /api/v1/admin/organizer-applications/{applicationId}/reject`
- `POST /api/v1/admin/organizers/{userId}/suspend`

## Frontend applications

The frontend (`frontend/`) is an npm workspace with two independent Next.js applications and shared packages. See [Frontend applications](docs/frontend-apps.md) for the route map, auth strategy and package layout.

| Application | Port | Contents |
| --- | --- | --- |
| `frontend/apps/user-web` — Dhanvi member app | 3000 | Landing, sign-in/registration, member dashboard, groups, contributions, Razorpay Checkout, payments, payouts, financial history, profile, organizer tools |
| `frontend/apps/admin-web` — Dhanvi Admin Portal | 3001 | Admin sign-in, platform overview, organizer applications, platform groups, payments and reconciliation, payouts, ledger |

Shared code lives once under `frontend/packages/` (`ui`, `api-client`, `auth`, `types`, `utils`, `config`, `features`). Both apps call the same backend API (`NEXT_PUBLIC_API_URL`, default `http://localhost:3002`); the backend remains the authorization authority and both apps also guard every route client-side by role.

```powershell
cd backend
npm ci
npm run dev          # Fastify API on 3002 (needs DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY in backend/.env)
npm run worker:dev   # BullMQ worker, separate terminal, no port

cd frontend
npm install
npm run dev          # member app on 3000 and admin portal on 3001
npm run dev:user     # member app only
npm run dev:admin    # admin portal only
```

Member portal routes: `/` (landing), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard` (Home), `/profile`, `/become-organizer`, `/organizer/application-status`, `/groups`, `/groups/[id]`, `/my-groups`, `/contributions`, `/payments`, `/payouts`, `/ledger` (financial history, linked from Payments), `/organizer`, `/organizer/groups`, `/organizer/groups/create`, `/organizer/groups/[id]`, `/organizer/groups/[id]/applications`, `/organizer/applications`, cycle contribution/auction/selection pages. Old `/admin/*` URLs on 3000 redirect to the admin portal.

Admin Control Center routes: `/login`, `/dashboard`, `/groups`, `/groups/create`, `/groups/[id]`, `/groups/[id]/cycles/[cycleId]/contributions`, `/groups/[id]/cycles/[cycleId]/auction`, `/organizers`, `/payments`, `/payments/[id]`, `/payouts`, `/payouts/[id]`, `/reconciliation`, `/ledger`, `/ledger/trial-balance`, `/ledger/accounts`, `/ledger/journals/[id]`, `/ledger/groups/[groupId]`, `/profile`. See [Member Portal vs Admin Control Center](docs/admin-control-center.md) for the information architecture, the next-action engine and the admin read models (`/api/v1/admin/operations/overview`, `/api/v1/admin/groups/operations`, `/api/v1/admin/groups/{id}/operations-summary`).

## Database migrations

`backend/sql/baseline/0000_baseline.sql` is the schema produced by the historical (pre-Fastify) migrations. On an
existing Dhanvi database `npm run db:migrate` (in `backend/`) adopts it without executing anything, then applies the
migrations owned by the new stack from `backend/sql/migrations/`. On an empty database it creates the schema from the
baseline. See [Database baseline](docs/fastify-migration/database-baseline.md).

## Tests and checks

```bash
cd backend
npm ci
npm run lint && npm run typecheck && npm run build
npm test                    # unit
npm run test:integration    # PostgreSQL 17 + Redis 7 via Testcontainers (Docker required)

cd ../frontend
npm install
npm run lint
npm run typecheck
npm test
npm run build        # builds apps/user-web then apps/admin-web
```

Integration tests run against real PostgreSQL (never SQLite) and real Redis: concurrent final-slot approval, concurrent
bids, the full Going Once → Final Call sequence, stale and duplicate BullMQ jobs, Razorpay webhook signatures over exact
bytes, ledger postings exactly once, payouts and cycle completion.

## Known limitations

- Password-reset requests are logged without the token; no email/SMS provider is configured (notifications are out of scope).
- Email verification storage is prepared, but send/confirm endpoints and a provider are not implemented.
- Suspended organizers cannot create or manage groups. Active group suspension blocks contribution operations; resume and all financial execution remain deferred.
- KYC, document uploads, MFA, and all financial workflows remain out of scope for this milestone.
