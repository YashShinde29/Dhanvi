# Frontend applications: member app and admin portal

The single `frontend/` Next.js application was separated into two independently built Next.js applications that share one backend, one database, one authentication authority and a set of shared frontend packages. No backend module was duplicated and no business logic was copied.

```text
Dhanvi User Web    http://localhost:3000   apps/user-web
Dhanvi Admin Web   http://localhost:3001   apps/admin-web
Same backend API   http://localhost:5000/api/v1
```

## Workspace layout

```text
package.json          npm workspaces: apps/*, packages/*; root dev/build/lint/typecheck/test scripts
tsconfig.base.json    shared compiler options; each app maps @dhanvi/* to packages/*/src via tsconfig paths
eslint.config.mjs     one lint configuration for both apps and every package
tests/                node --test structural checks (ports, route placement, guards, Checkout location, shared client)
apps/
  user-web/           Next.js 16, port 3000: public, member and organizer experience; Razorpay Checkout
  admin-web/          Next.js 16, port 3001: platform operations
packages/
  ui/                 design system (components, icons, brand, globals.css, confirm dialog hook)
  api-client/         one typed fetch client (cookie credentials, single 401 refresh) plus every *.service module
  auth/               AuthProvider with per-app policy, ProtectedPage guard, role helpers
  types/              shared DTO types (auth, groups, contributions, auctions, payments, payouts, ledger, selection)
  utils/              money/date formatting, status presentation, error mapping, form validation, data hooks
  config/             public runtime configuration: API base URL, app kind, cross-app URLs, group policy
  features/           shared feature screens (groups, contributions, auctions, selections, payments, payouts, ledger,
                      organizers, dashboards, profile, marketing) and generic shell primitives (sidebar, header,
                      mobile nav, user menu, public shell) driven by a per-app ShellConfig
```

Packages are plain TypeScript source consumed through tsconfig `paths`; Next compiles them as part of each app. An app never imports another app's `src`, and no package depends on an app (enforced by `tests/app-separation.test.mjs`).

## Route migration

| Old route (single app, 3000) | Class | New location |
| --- | --- | --- |
| `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` | PUBLIC | user-web, unchanged |
| `/dashboard`, `/profile`, `/become-organizer`, `/organizer/application-status` | USER | user-web, unchanged |
| `/groups`, `/groups/[id]`, `/groups/[id]/cycles/[cycleId]/auction`, `/groups/[id]/cycles/[cycleId]/selection/verify`, `/my-groups` | PUBLIC/USER | user-web, unchanged |
| `/contributions` (Razorpay Checkout), `/payments`, `/payments/[id]`, `/payouts`, `/payouts/[id]`, `/ledger` | USER | user-web, unchanged |
| `/organizer`, `/organizer/groups`, `/organizer/groups/create`, `/organizer/groups/[id]`, `/organizer/groups/[id]/applications`, `/organizer/groups/[id]/cycles/[cycleId]/contributions`, `/organizer/groups/[id]/cycles/[cycleId]/auction`, `/organizer/groups/[id]/payouts`, `/organizer/applications` | ORGANIZER | user-web, unchanged |
| `/admin` | ADMIN | admin-web `/dashboard` |
| `/admin/organizers` | ADMIN | admin-web `/organizers` |
| `/admin/groups`, `/admin/groups/create`, `/admin/groups/[id]`, `/admin/groups/[id]/cycles/[cycleId]/contributions`, `/admin/groups/[id]/cycles/[cycleId]/auction` | ADMIN | admin-web `/groups...` |
| `/admin/payments`, `/admin/payments/[id]` | ADMIN | admin-web `/payments`, `/payments/[id]` |
| `/admin/payouts`, `/admin/payouts/[id]` | ADMIN | admin-web `/payouts`, `/payouts/[id]` |
| `/admin/ledger`, `/admin/ledger/trial-balance`, `/admin/ledger/accounts`, `/admin/ledger/journals/[id]`, `/admin/ledger/groups/[groupId]` | ADMIN | admin-web `/ledger...` |
| — | ADMIN | admin-web `/login` (new), `/profile` (shared profile screen), `/` → `/dashboard` |

`apps/user-web/next.config.ts` redirects `/admin` → `{ADMIN_URL}/dashboard`, `/admin/organizers` → `{ADMIN_URL}/organizers` and `/admin/:path*` → `{ADMIN_URL}/:path*`. The member app no longer contains any admin page file. Shared feature screens build management links through `managePrefix(scope)` (`/organizer` for organizer scope, unprefixed for admin scope), so the same `GroupDetailPage`, `ManageContributionsPage`, `AuctionPage`, `PaymentsPage`, `PayoutsPage` and ledger pages render in whichever app mounts them.

## Authentication

The backend already issues HttpOnly, `SameSite=Strict` cookies (`dhanvi_access`, `dhanvi_refresh`) for host `localhost`. Cookies are scoped by host, not port, so **one sign-in is shared by both apps**; nothing was moved to browser storage and no token ever travels through a URL. Signing out on either app clears the cookies for both.

Each app supplies an `AppAuthConfig` to the shared `AuthProvider`:

| | user-web | admin-web |
| --- | --- | --- |
| `allowedRoles` | `USER`, `ORGANIZER` (administrators also hold `USER`) | `ADMIN`, `SUPER_ADMIN` (the backend has no `FINANCE` role, so none was invented) |
| `homePath` | `/dashboard` | `/dashboard` |
| forbidden screen | "This account cannot use the Dhanvi member app." + Open Admin Portal | "You do not have permission to access the Dhanvi Admin Portal." + Go to Dhanvi |

`ProtectedPage` wraps every non-public page in both apps: anonymous visitors are redirected to that app's `/login?returnUrl=…`; a signed-in account outside the app's allowed roles sees the forbidden screen and never the page; page-level roles (e.g. `ORGANIZER`) fall back to the app home. The shared `LoginForm` sends a permitted account to the home path (or a safe same-origin `returnUrl`) and skips the form entirely when the shared cookie already carries a permitted session. The backend continues to enforce roles, ownership and policies on every API call; admin endpoints return 403 to members regardless of which frontend calls them.

Cross-links: administrators signed in to the member app get an "Open Admin Portal" entry in the sidebar and account menu (`NEXT_PUBLIC_ADMIN_URL`); the admin portal sidebar, account menu and forbidden screen link "Go to Dhanvi" (`NEXT_PUBLIC_USER_APP_URL`).

## Backend change

`Program.cs` CORS now allows an explicit list of origins with credentials: `Frontend:Origins` (appsettings, `http://localhost:3000` and `http://localhost:3001`) or the env-friendly `Frontend__Origin` (`;`/`,`-separated), which Compose sets from `FRONTEND_ORIGIN`. `AllowAnyOrigin` is never combined with credentials. `CorsPolicyTests` verifies both origins are accepted and unknown origins get no `Access-Control-Allow-Origin` header.

## Environment variables

| Variable | user-web | admin-web |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | yes | yes |
| `NEXT_PUBLIC_APP_KIND` | `user` | `admin` |
| `NEXT_PUBLIC_ADMIN_URL` | cross-link and `/admin/*` redirect target | — |
| `NEXT_PUBLIC_USER_APP_URL` | — | cross-link target |
| `NEXT_PUBLIC_MIN_GROUP_MEMBERS` | `.env.development`/`.env.test` set 2; production stays 20 | same |

Razorpay Checkout needs no frontend env: the public `rzp_test_` key arrives from the backend in the Checkout response and the admin portal never loads Checkout. No secret belongs in either app.

## Razorpay and webhooks

Checkout (`packages/features/src/payments/payment-checkout.tsx`) is mounted only by the member app (`/contributions` and the member's group contribution card). The backend-configured return base URL `http://localhost:3000/checkout/return` is unchanged (the flow uses Razorpay's JavaScript handler, not a redirect). `POST /api/v1/payments/webhooks/razorpay` remains backend-only.

## Docker

`docker-compose.yml` replaces `frontend` with `user-web` (3000) and `admin-web` (3001), each built from the repository root with `apps/<app>/Dockerfile` (workspace-aware, standalone output traced from the workspace root). The Compose backend receives both origins through `FRONTEND_ORIGIN`.

## Verification (2026-09-15)

- Backend Release build: 0 warnings, 0 errors; full test suite passed (unit 214, architecture 14, PostgreSQL integration 184 including 4 new CORS cases).
- `npm run lint`, `npm run typecheck`, `npm test` (15 structural tests), `npm run build:user`, `npm run build:admin`: all passed.
- Browser verification against the running backend: 37 checks passed — landing/login on 3000; member, organizer and admin sign-ins; member and organizer refused on 3001 with the permission message and no admin content; admin dashboard, organizers, groups, payments (detail + live Razorpay reconciliation), payouts, ledger, trial balance, accounts and journal links on 3001; Razorpay Checkout opening on 3000; shared session across ports without re-login; `/admin/payments` on 3000 redirecting to 3001; logout on one app ending the session for both; anonymous access redirecting to each app's login with `returnUrl`; phone-width layouts with mobile navigation in both apps.

## Limitations

- Route guards in both apps are client-side (as before); the backend remains the security boundary.
- Docker images were rewritten for the workspace layout but not built in this verification.
- The admin portal has no marketing site; `/` redirects to `/dashboard`, and unknown paths show a not-found page linking to the admin dashboard.
