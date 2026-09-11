# Dhanvi

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
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base URL |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OpenTelemetry collector endpoint |

Admin seeding is idempotent. After the first account is created, disable it and restart the API. Never use the example credentials in a shared or production environment.

## Run with Docker

```powershell
docker compose up --build
```

Open:

- Frontend: `http://localhost:3000`
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

## Frontend routes

The implemented pages are `/` (landing), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard`, `/profile`, `/become-organizer`, `/organizer/application-status`, `/organizer`, `/organizer/applications`, `/admin`, and `/admin/organizers`. The frontend uses a token-based design system (`src/app/globals.css`), shared UI components (`src/components/ui`), a role-aware application shell (`src/components/layout`), and shared formatters/status mappings (`src/lib`). Protected pages provide client-side UX guards; the API independently enforces every authorization policy.

The group routes are `/groups`, `/groups/[id]`, `/my-groups`, `/organizer/groups`, `/organizer/groups/create`, `/organizer/groups/[id]`, `/organizer/groups/[id]/applications`, `/admin/groups`, `/admin/groups/create`, and `/admin/groups/[id]`.

Additional contribution pages are `/contributions`, `/organizer/groups/[id]/cycles/[cycleId]/contributions`, and `/admin/groups/[id]/cycles/[cycleId]/contributions`. Active group pages include cycle schedules and aggregate progress.

Random selection verification is available at `/groups/[id]/cycles/[cycleId]/selection/verify`. Existing group cycle panels expose selection execution/result views according to backend authorization.

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

Set-Location ../frontend
npm run lint
npm run build
```

Docker must be running for the integration tests. Testcontainers applies the real migrations to disposable PostgreSQL and verifies registration, duplicate email handling, password safety, login, authorization, refresh rotation/reuse protection, password reset reuse protection, organizer application rules, admin approval/rejection, role assignment, and audit creation. Group tests additionally verify all four creator/mechanism combinations, terms, privacy, readiness, and real concurrent final-slot approval. Cycle/contribution tests also verify atomic activation and rollback, 20/50-member schedules, private histories, manual recording/reversal, idempotency, concurrent over-record prevention, readiness, and overdue dates.

## Known limitations

- The development email sender logs that a reset was requested; configure a real `IEmailSender` before production email delivery.
- Email verification storage is prepared, but send/confirm endpoints and a provider are not implemented.
- Suspended organizers cannot create or manage groups. Active group suspension blocks contribution operations; resume and all financial execution remain deferred.
- KYC, document uploads, MFA, and all financial workflows remain out of scope for this milestone.
