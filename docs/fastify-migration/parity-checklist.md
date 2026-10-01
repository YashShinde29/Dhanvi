# .NET → Fastify parity checklist

Migration record. Produced from a full audit of the former ASP.NET Core backend (ASP.NET Core 10, EF Core 10, Npgsql,
Hangfire 1.8) before any Fastify code was written; that code has since been removed from the repository (see git history).
Every row names the original .NET source and how parity is proven. "Contract" means the HTTP route, method, request shape,
response shape and error codes; before removal, a contract-parity run executed 75 scenario steps against both stacks on fresh
databases and found **75/75 identical** (status, keys, value types, codes).

Legend: ✅ ported and verified · ➕ new behavior requested in the migration brief · ⚠️ known difference (see bottom).

## Platform

| Concern | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| Error model (ProblemDetails, `code`, `traceId`, `errors`) | `Dhanvi.Api/Middleware/GlobalExceptionHandler.cs` | `plugins/error-handler.ts`, `utils/errors.ts` | ✅ parity run (invalid input, 401/403/404/409 steps) |
| 403-vs-409 split for group authorization codes | same | `GroupRuleError` | ✅ |
| Correlation id `X-Correlation-ID` | `CorrelationIdMiddleware.cs` | `plugins/request-context.ts` | ✅ |
| JSON: enums `SNAKE_CASE_UPPER`, decimals with scale, camelCase | `Program.cs` JSON options | `utils/enums.ts`, `Decimal.toJSON` (raw `50000.00`) | ✅ byte-identical sample |
| Exact decimal request tokens (`{"discountAmount":5000.50}`) | System.Text.Json decimal | `utils/json.ts` (source-text reviver) | ✅ unit + integration |
| GUID route constraints (`{id:guid}` → 404) | minimal API | `utils/http.ts` `G` regex params | ✅ parity "non-guid route" |
| CORS: two explicit origins, credentials | `Program.cs` | `plugins/cors.ts` | ✅ |
| Rate limits: auth 10/min/IP, password reset 5/15 min/IP | `Program.cs` | `routes/api/v1/rate-limits.ts` | ✅ |
| Health `/health`, `/health/ready` | `Program.cs` | `routes/api/v1/health` | ✅ parity |
| OpenAPI | Swashbuckle `/swagger` | `@fastify/swagger(-ui)` `/swagger` | ✅ |
| Structured logs (Serilog JSON) | `Program.cs` | Pino with redaction (`app.ts` `REDACT`) | ✅ |
| Hangfire | `AddHangfire` + server — **no jobs were ever enqueued** | BullMQ (`queues/`, `workers/`) | ✅ nothing to port; ➕ new auction jobs |

## Identity & organizers

| Behavior | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| Register/login/refresh/logout/forgot/reset/me/profile/password | `IdentityService.cs`, `IdentityEndpoints.cs` | `features/auth/*` | ✅ `identity.test.ts`, parity |
| Password hashes (Identity V3, PBKDF2-SHA512, 100k) — existing hashes verify | `PasswordHasher<User>` | `utils/crypto.ts` | ✅ verified against a real .NET hash |
| Rehash on legacy parameters | `SuccessRehashNeeded` | same | ✅ |
| JWT claim set (`sub,email,nameidentifier URI,role URI,nbf,exp,iss,aud`) | `TokenService.cs` | `token.service.ts` | ✅ claim keys asserted |
| Cookies `dhanvi_access`/`dhanvi_refresh` HttpOnly, SameSite=Strict, Max-Age | `AuthenticationCookies` | `auth.controller.ts` | ✅ |
| Refresh rotation; reuse rejected; logout revokes; password change/reset revoke all | `IdentityService.cs` | same | ✅ (rotation now also row-locked) |
| Unknown-email login timing equalization | `VerifyDummyPassword` | same | ✅ |
| Roles USER/ORGANIZER/ADMIN/SUPER_ADMIN; policies AuthenticatedUser/OrganizerOnly/AdminOnly/SuperAdminOnly | `AuthorizationPolicies.cs` | `plugins/auth.ts` | ✅ |
| Organizer apply/approve (role grant + audit once)/reject/suspend | `OrganizerService.cs` | `features/organizer/*` | ✅ |
| Seed: roles, chart of accounts, optional SUPER_ADMIN | `IdentitySeeder.cs`, `LedgerSeeder` | `auth.service.seed`, `infra/database/seed.ts` | ✅ |

## Groups, memberships, cycles, contributions

| Behavior | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| Four combinations Platform/Organizer × Random/Auction | `Group.cs`, `GroupService.cs` | `features/group/*` | ✅ `groups-cycles.test.ts` (each combination) |
| Rule validation codes (precision, schedule, platform, start date, member limit) | `GroupRules` | `group.domain.ts` | ✅ |
| Member policy: dev/test 2–50, production 20–50 enforced at startup | `GroupPolicyOptions.cs` | `config/groups.ts` | ✅ |
| Rules stored as EF `jsonb` (PascalCase, enum ordinals) — readable by both stacks | `GroupsDbContext` | `rulesNetValue/rulesFromJson` | ✅ adopted-DB smoke |
| Rule version snapshot + SHA-256 hash; accept-terms requires current id+hash | `GroupRuleVersion` | same | ✅ |
| Capacity under the group row lock; final slot approved exactly once | `GroupService.ExecuteAsync` + `FOR UPDATE` | same | ✅ concurrent approval test |
| Organizer-first payout → cycle 1 `ORGANIZER_RESERVED` | `Group.FirstCycleSelectionMethod` | same | ✅ |
| Activation: one transaction creates N cycles × N obligations, activates members; replay returns schedule | `GroupCycleService.ActivateAsync` | `cycle.service.ts` | ✅ |
| Monthly schedule (first due on/after start, selection/payout in due month) | `CycleSchedule.Generate` | `cycle.domain.ts` | ✅ dates asserted |
| Manual record/reverse: idempotency key + .NET request hash, over-record and reference checks, overdue | `GroupCycleService.Operate` | same | ✅ incl. concurrent over-record |
| Contribution ≠ payment: manual tracking never posts a journal | `LedgerPostingRules` | same | ✅ |
| Readiness recalculation / reopen after reversal | `MonthlyCycle.Recalculate` | same | ✅ |

## Selection

| Behavior | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| DHANVI_RANDOM_V1 (seed commit/reveal, canonical set hash, rejection sampling) | `RandomDrawV1.cs` | `random-draw.algorithm.ts` | ✅ cross-checked with `tools/verify-random-draw.py` |
| Never `Math.random` | — | `crypto.randomBytes`; ESLint rule forbids `Math.random` | ✅ |
| Eligibility & readiness policy | `SelectionPolicy.cs` | `selection.policy.ts` | ✅ |
| Idempotent, immutable `SelectionResult` (+ trigger) | `SelectionService.cs` | `random-draw.service.ts` | ✅ concurrent execute returns one result |

## Auctions

| Behavior | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| Calculator DHANVI_AUCTION_V1 (₹50,000 / ₹5,000 → ₹45,000, shares ₹500) | `AuctionCalculator.cs` | `auction.domain.ts` | ✅ unit + integration |
| Min/max/increment/precision, sequence, immutable bids, eligibility | `Auction.Bid`, triggers | same | ✅ |
| Bid idempotency (scope `a:…`, fingerprint format `0.00##…`) | `AuctionService.BidAsync` | same | ✅ |
| Concurrency: group → cycle → auction row locks | `AuctionStore.Run` | `auction.service.ts` | ✅ simultaneous equal bids |
| Manual open/close (operator) | `OpenAsync/CloseAsync` | same | ✅ |
| Finalization: selection + result + allocations + payout right + cycle + funded journal | `CloseAsync` | `finalize()` | ✅ |
| Rescheduling (reason codes, OTHER ≥5 chars, idempotent, version check, blocked when open, immutable history, member-sanitized, paged) | `RescheduleAsync`, history reader | same | ✅ |
| ➕ Automatic open at `StartsAt` | — (manual in .NET) | `automationOpen` + `OPEN_AUCTION` | ✅ |
| ➕ Digital closing sequence GOING_ONCE→GOING_TWICE→FINAL_WARNING→FINALIZING→COMPLETED, reset on higher bid, configurable durations | — | `advanceClosing`, migration `0001` | ✅ unit + integration + real BullMQ |
| ➕ Stale/duplicate job safety (ClosingVersion, highest bid) | — | `automationClose` | ✅ |

## Finance

| Behavior | .NET source | Fastify | Proof |
| --- | --- | --- | --- |
| Razorpay TEST: order intent before provider call, never auto-repeat POST | `PaymentService.CreateAsync` | `payment.service.ts` | ✅ uncertain-order test |
| Checkout signature, webhook HMAC over **exact raw bytes** | `RazorpaySignatures` | `plugins/raw-body.ts`, gateway | ✅ tamper test |
| Event dedupe (EventKey, advisory lock), reused id + new payload rejected | `ProcessWebhookAsync` | same | ✅ |
| Capture → contribution settled → Dr 1010 / Cr 2000 exactly once | `Apply` + `CapturePaymentAsync` | same | ✅ verify + webhook + replay = 1 journal |
| Failure, refund pending/failed/processed, refund reversal journal, sticky mismatch | `Apply`, `Payment.cs` | same | ✅ |
| Persisted payment/reconciliation states unchanged | `PaymentStatus` | `payment.domain.ts` | ✅ |
| Ledger: chart, journals, lines, balance, append-only, reversal, trial balance, member view | Ledger module + `LedgerDatabaseGuards` | `features/ledger/*` | ✅ |
| Ledger idempotency fingerprints byte-identical to .NET (replays of pre-cutover journals) | `LedgerSourceReader.Stamp` | `utils/dotnet-json.ts` | ✅ golden values from .NET 10 |
| Payout types WINNER_PAYOUT / MEMBER_AUCTION_BENEFIT / PLATFORM_FEE_SETTLEMENT | `PayoutService.cs` | `payout.service.ts` | ✅ |
| Beneficiary validation, masking, 24 h change hold, step-up password | `PayoutBeneficiary`, endpoints | same | ✅ |
| Approval (no self-approval), durable attempt, FAKE provider, reconcile, retry, settlement Dr 2100/2200 / Cr 1020, cycle completion → next cycle / group completion | `PayoutService.cs`, `FakePayoutGateway.cs` | same | ✅ end-to-end test |
| Admin Control Center read models | `AdminOperationsService` + readers | `features/admin/*` | ✅ parity (overview/list/summary) |

## Known differences ⚠️

1. **Timestamp notation** in JSON: `2026-10-01T09:14:44.006Z` (ms, `Z`) instead of `…44.006977+00:00`. Both web apps parse
   with `new Date()`; values written by Node have millisecond precision. Existing µs values are never rewritten
   (column-level change tracking) and are read as µs text wherever they feed fingerprints.
2. **New behavior (requested):** automatic auction open and the digital closing sequence. In .NET an operator opened and
   closed auctions manually; both manual actions remain available and unchanged.
3. `RandomSourceType` for new draws is `NODE_CRYPTO_RANDOM_BYTES` (was `DOTNET_RANDOM_NUMBER_GENERATOR`) — it records the
   actual entropy source; the algorithm and proof format are unchanged.
4. Request binding errors (wrong JSON types) now include a field `errors` dictionary in the 400 body.
5. Refresh-token rotation and organizer applications take a row lock (closing a race the .NET version had).
6. Organizer-application search escapes `%`/`_` wildcards.
7. Re-serialized CHECK constraints in a freshly created database differ only in PostgreSQL's parenthesization.
