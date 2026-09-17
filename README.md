# Dhanvi

Prompt 8 incoming Razorpay Test payments and their verification are documented in the [final Prompt 8 report](docs/prompt-8-verification.md). It supersedes older milestone statements below about payments and Ledger being deferred; payout execution remains deferred.

Dhanvi is a production-minded foundation for a community savings platform. The current milestone implements authentication, user accounts, platform roles, profiles, organizer application approval, and savings groups, activation, monthly schedules, and manual contribution tracking, and verifiable random/organizer-reserved selection through SELECTION_COMPLETED in a .NET 10 modular monolith with a Next.js frontend and PostgreSQL. Auction bidding and calculated payout rights are implemented; financial execution, payments, real payouts, and ledger behavior remain deferred. See [Auction engine](docs/auction-engine.md) and [Windows verification](docs/prompt-6-windows-verification.md). See [Groups and membership foundation](docs/groups-foundation.md) for rules, APIs, migration, concurrency, frontend pages, and operational details. See [Monthly cycles and contribution tracking](docs/cycles-and-contributions.md) for the activation transaction, timezone, idempotency, reversals, new APIs, and migration. See [Random and organizer-reserved selection](docs/random-and-reserved-selection.md) for the V1 algorithm, proof format, payout-right semantics, APIs, and migration.

## Architecture

The backend is one deployable ASP.NET Core process with module-owned Domain, Application, Infrastructure, and API projects. Identity, Organizers, Groups, and Audit each own an EF Core `DbContext`, PostgreSQL schema, and migration history. A scoped PostgreSQL connection allows multi-module approval operations to enlist in one database transaction.

Authentication uses a 15-minute JWT access token and a longer-lived random opaque refresh token. Refresh tokens are SHA-256 hashed in PostgreSQL, rotated on use, and revocable. The API supports bearer headers for API clients and HttpOnly, SameSite cookies for the web app. Backend authorization policies remain the source of truth.

## Prerequisites

- Docker Desktop with Docker Compose
- Node.js 20.9+ and npm 10+ for manual frontend development
- .NET 10 SDK for manual backend development
- PostgreSQL 18 or a compatible supported PostgreSQL release when not using Docker

## Configuration

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder values. Do not commit `.env`.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local PostgreSQL settings |
| `BACKEND_PORT`, `FRONTEND_PORT` | Host application ports |
| `JWT_SIGNING_KEY` | Random secret of at least 32 characters; use a secret manager in production |
| `DHANVI_SEED_ADMIN_ENABLED` | Set `true` only when intentionally creating the initial super admin |
| `DHANVI_SEED_ADMIN_EMAIL`, `DHANVI_SEED_ADMIN_PASSWORD` | Initial super-admin credentials when seeding is enabled |
| `FRONTEND_ORIGIN` | Browser origins allowed by the API (`;`-separated); defaults to both web apps |
| `ADMIN_PORT`, `USER_APP_URL`, `ADMIN_APP_URL` | Admin portal host port and the cross-app link URLs baked into each web app |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base URL |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OpenTelemetry collector endpoint |

Admin seeding is idempotent. After the first account is created, disable it and restart the API. Never use the example credentials in a shared or production environment.

## Run with Docker

```powershell
docker compose up --build
```

Open:

- Member web app: `http://localhost:3000`
- Admin portal: `http://localhost:3001`
- API health: `http://localhost:5000/api/v1/health`
- Swagger: `http://localhost:5000/swagger`

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

The frontend is an npm workspace with two independent Next.js applications and shared packages. See [Frontend applications](docs/frontend-apps.md) for the route map, auth strategy and package layout.

| Application | Port | Contents |
| --- | --- | --- |
| `apps/user-web` — Dhanvi member app | 3000 | Landing, sign-in/registration, member dashboard, groups, contributions, Razorpay Checkout, payments, payouts, financial history, profile, organizer tools |
| `apps/admin-web` — Dhanvi Admin Portal | 3001 | Admin sign-in, platform overview, organizer applications, platform groups, payments and reconciliation, payouts, ledger |

Shared code lives once under `packages/` (`ui`, `api-client`, `auth`, `types`, `utils`, `config`, `features`). Both apps call the same backend API; the backend remains the authorization authority and both apps also guard every route client-side by role.

```powershell
npm install
npm run dev          # member app on 3000 and admin portal on 3001
npm run dev:user     # member app only
npm run dev:admin    # admin portal only
```

Member portal routes: `/` (landing), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard` (Home), `/profile`, `/become-organizer`, `/organizer/application-status`, `/groups`, `/groups/[id]`, `/my-groups`, `/contributions`, `/payments`, `/payouts`, `/ledger` (financial history, linked from Payments), `/organizer`, `/organizer/groups`, `/organizer/groups/create`, `/organizer/groups/[id]`, `/organizer/groups/[id]/applications`, `/organizer/applications`, cycle contribution/auction/selection pages. Old `/admin/*` URLs on 3000 redirect to the admin portal.

Admin Control Center routes: `/login`, `/dashboard`, `/groups`, `/groups/create`, `/groups/[id]`, `/groups/[id]/cycles/[cycleId]/contributions`, `/groups/[id]/cycles/[cycleId]/auction`, `/organizers`, `/payments`, `/payments/[id]`, `/payouts`, `/payouts/[id]`, `/reconciliation`, `/ledger`, `/ledger/trial-balance`, `/ledger/accounts`, `/ledger/journals/[id]`, `/ledger/groups/[groupId]`, `/profile`. See [Member Portal vs Admin Control Center](docs/admin-control-center.md) for the information architecture, the next-action engine and the admin read models (`/api/v1/admin/operations/overview`, `/api/v1/admin/groups/operations`, `/api/v1/admin/groups/{id}/operations-summary`).

## Database migrations

Checked-in migrations:

- Identity: `IdentityAndAuthentication`
- Organizers: `OrganizerApplications`
- Audit: `IdentityAuditLog`
- Groups: `GroupsAndMembershipFoundation` (groups, memberships, rules snapshots, terms acceptances, and group audit events)
- Groups: `MonthlyCyclesAndContributionTracking` (monthly cycles, obligations, append-only contribution entries, and idempotency receipts)
- Groups: `RandomAndReservedSelectionFoundation` (immutable selection results and relational eligible snapshots, cycle completion, and payout-right naming)

- Groups: `AuctionEngine` (auctions, append-only bids, immutable results and calculated allocations, auction selection integration)

They create `identity.users`, `identity.roles`, `identity.user_roles`, `identity.refresh_tokens`, `identity.password_reset_tokens`, `identity.email_verification_tokens`, `organizers.organizer_profiles`, `organizers.organizer_applications`, and `audit.audit_logs`, with the required indexes and constraints.

Compose applies these migrations when the API starts. For manual development, set `ConnectionStrings__DefaultConnection` and run each module context from `backend`:

```powershell
dotnet ef database update --project src/Modules/Audit/Dhanvi.Modules.Audit.Infrastructure --context AuditDbContext
dotnet ef database update --project src/Modules/Identity/Dhanvi.Modules.Identity.Infrastructure --context IdentityDbContext
dotnet ef database update --project src/Modules/Organizers/Dhanvi.Modules.Organizers.Infrastructure --context OrganizerDbContext
dotnet ef database update --project src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure --context GroupsDbContext
```

## Tests and checks

```powershell
Set-Location backend
dotnet restore Dhanvi.sln
dotnet build Dhanvi.sln -c Release
dotnet test Dhanvi.sln -c Release

Set-Location ..
npm install
npm run lint
npm run typecheck
npm test
npm run build        # builds apps/user-web then apps/admin-web
```

Docker must be running for the integration tests. Testcontainers applies the real migrations to disposable PostgreSQL and verifies registration, duplicate email handling, password safety, login, authorization, refresh rotation/reuse protection, password reset reuse protection, organizer application rules, admin approval/rejection, role assignment, and audit creation. Group tests additionally verify all four creator/mechanism combinations, terms, privacy, readiness, and real concurrent final-slot approval. Cycle/contribution tests also verify atomic activation and rollback, 20/50-member schedules, private histories, manual recording/reversal, idempotency, concurrent over-record prevention, readiness, and overdue dates.

## Known limitations

- The development email sender logs that a reset was requested; configure a real `IEmailSender` before production email delivery.
- Email verification storage is prepared, but send/confirm endpoints and a provider are not implemented.
- Suspended organizers cannot create or manage groups. Active group suspension blocks contribution operations; resume and all financial execution remain deferred.
- KYC, document uploads, MFA, and all financial workflows remain out of scope for this milestone.
