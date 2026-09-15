# Razorpay TEST incoming contribution verification

Verified on 2026-09-15 against the existing Prompt 8 implementation. An actual Razorpay TEST-mode incoming contribution payment was completed end-to-end: backend order creation, real Razorpay Checkout in the member UI, server-side signature verification, captured settlement, Ledger posting, live reconciliation, and a real full refund with a reversing journal. Prompt 8 and Prompt 9 were not redesigned; no payout, production, or live-mode operation was performed.

## Environment detection

The six exact variables were not inherited by the process running this verification (variables exported in a separate terminal do not reach an already-running parent process). They were supplied to the backend process at launch time only, through a session-local launcher outside the repository, under the exact names below. No credential value was printed, logged, committed, or copied into any repository, test, screenshot, or report file.

| Variable | Result |
|---|---|
| `Payment_RazorpayEnabled` | `true` |
| `Payment_RazorpayKeyId` | `rzp_test_****Tunc` (public TEST key) |
| `Payment_RazorpayKeySecret` | configured |
| `Payment_RazorpayCheckoutReturnBaseUrl` | `http://localhost:3000/checkout/return` |
| `Payment_WebhookEnabled` | `true` |
| `Payment_WebhookSecret` | configured |

The working copy of the tracked `.env.example` briefly contained the real values before this run. It was restored to its committed placeholder content; the values were preserved only in the git-ignored root `.env`, which is the documented Compose location. HEAD, all reachable Git history, frontend source, and the production bundle contain none of the three values.

## Configuration binding and startup

`PaymentsModule.AddPaymentsModule` binds the six names directly from `IConfiguration` (process environment included by `WebApplication.CreateBuilder`) with `ValidateOnStart`; legacy `Payments:Razorpay:Enabled` / `RAZORPAY_*` names remain as fallbacks. `RazorpayOptions.Valid()` enforces `TEST`, an `rzp_test_` key, a loopback-or-HTTPS return URL, and a webhook secret when webhooks are enabled. The key secret and webhook secret are separate options; the webhook secret is never used for Checkout signatures and vice versa. No code change was required for binding.

Backend: `dotnet run --no-launch-profile -c Release` from `backend/src/Dhanvi.Api` with `ASPNETCORE_ENVIRONMENT=Development`, local PostgreSQL 18 database `dhanvi_smoke`, `Database__ApplyMigrations=true`. All module migrations applied (Audit, Identity, Organizers, Groups, Ledger, Payments, Payouts); the Ledger seeder created account `1010` Razorpay test payment gateway clearing and `2000` Group pool liability. Startup validation passed with Razorpay enabled. Backend URL `http://localhost:5000`; frontend `npm run dev` at `http://localhost:3000`.

## Checkout return URL

The existing Checkout uses Razorpay's JavaScript `handler`, which POSTs `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to the authenticated `POST /api/v1/payments/{id}/verify`. There is no redirect `callback_url`, so no `/checkout/return` page is required or was added; the configured return base URL is bound and validated but inert. No duplicate return flow was created.

## Scenario built through the public API only

Seeded super admin created a platform group with `collectionMode: RAZORPAY`, value ₹200, two members (Development policy allows 2), start date 2026-09-16. Two registered members applied, were approved, accepted the rules version/hash; admin confirmed readiness and activated. Cycle 1 opened `CollectingContributions` with two ₹100 obligations. Payment eligibility returned `canPay: true`, `remainingAmount: 100.00`.

## Smoke-test results

| Item | Result |
|---|---|
| Razorpay TEST order creation | `POST /contributions/{id}/payments` with an `Idempotency-Key` and an empty body created internal Payment `e168ca03-…` and Razorpay order `order_TcDSlxt2rJbRwM`, amount 10000 paise (₹100.00) determined by the backend from the obligation, currency INR, environment TEST. Response contained the public `rzp_test_` key only; exact-value scan of the response for both secrets: 0 matches. |
| Checkout opened | Real Razorpay Checkout (Test Mode ribbon, ₹100, "Dhanvi · Razorpay Test") opened from the member `/contributions` card. Driven headlessly through the actual UI: Pay → Continue to Razorpay → contact → Netbanking → Canara Bank → Razorpay demo bank → Success. |
| Payment 1 (`e168ca03`, `pay_TcDX885AxaBvae`) | The headless browser was closed before the handler fired, so `/verify` never arrived. Member `POST /payments/{id}/refresh` (live reconciliation) fetched provider order and payment, matched identity/amount/currency/captured state, and settled: `CAPTURED`, `MATCHED`, journal `JRN-000000000001`. This exercised the lost-callback recovery path. |
| Payment 2 (`d2245411`, `pay_TcDaA534JVCte9`, `order_TcDYIcdz4q8oMh`) | Full path: handler → `POST /payments/{id}/verify` → HTTP 200 → `PAYMENT_SIGNATURE_VERIFIED`, `PAYMENT_CAPTURED`, `CAPTURED`, `MATCHED`, journal `JRN-000000000002`. UI showed "Gateway settled · Razorpay Test Mode". |
| Authoritative status | Both payments `Status = Captured`, `ReconciliationStatus = Matched`, `CapturedAt`, `SettledAt`, `JournalId` set, `Environment = TEST`. |
| Contribution settlement | Both cycle-1 contributions `FinancialStatus = Settled`, `FinanciallySettledAmount = 100.00`, `SettledPaymentId` linked. Prompt 4 manual `Status` stayed `Pending` and `RecordedAmount` 0. Cycle 1 `FinanciallySettledAmount = 200.00` and transitioned to `ReadyForSelection`. |
| Ledger | Exactly one `PaymentCaptured` journal per payment, two lines each: Debit `1010` payment gateway clearing 100.00 / Credit `2000` group pool liability 100.00; lines carry PaymentId, ContributionId, GroupId. Total debit = total credit. |
| Duplicate verification / reconciliation | Four additional member refreshes plus one admin reconcile: no new journal, no settlement change, only `PAYMENT_RECONCILIATION_MATCHED` history rows. Verify replay with an invalid signature → 409 `INVALID_PAYMENT_SIGNATURE`; wrong order ID → 409 `PAYMENT_ORDER_MISMATCH`; another member's payment → 403. |
| Reconciliation against the provider | Independent Razorpay TEST API reads: both payments `captured`, 10000 INR, both orders `paid` with `amount_paid` 10000, receipts `dh_<paymentId>`, notes carrying the internal Payment/Contribution/Group/Cycle IDs. All matched `MATCHED`. |
| Refund | Full refund `rfnd_TcDdmZQdLmHi2u` issued at Razorpay TEST for payment 1. Member refresh observed `amount_refunded = amount`, status `refunded`: Payment `REFUNDED`, `RefundedAt` set, reversing journal `JRN-000000000003` (Debit `2000` group pool liability / Credit `1010` clearing, 100.00) referencing `JRN-000000000001`, which was preserved. Contribution reverted to `Refunded`, 0.00 settled, `SettledPaymentId` cleared; cycle reopened to `CollectingContributions` (100.00 settled); eligibility returned `canPay: true` with no current payment. Second refresh created no further reversal. `PaymentRefunds` rows are only recorded from webhook refund entities, so none exist for this reconciliation-observed refund. |
| Webhook route | `POST /api/v1/payments/webhooks/razorpay` mapped (anonymous). Live requests: missing signature → 409 `INVALID_WEBHOOK_SIGNATURE`; invalid signature → 409; zero `PaymentProviderEvents` stored. Signature is verified over the raw request bytes with `Payment_WebhookSecret`. |
| Public webhook delivery | NOT TESTED. The backend ran only on localhost; Razorpay cannot reach it without a public HTTPS tunnel, which was intentionally not created or hardcoded. |
| Audit | `audit.audit_logs` holds every payment action (`PAYMENT_ORDER_REQUESTED/CREATED`, `PAYMENT_SIGNATURE_VERIFIED`, `PAYMENT_CAPTURED`, `PAYMENT_RECONCILIATION_MATCHED`, `PAYMENT_REFUNDED`) and `LEDGER_JOURNAL_POSTED`; `groups.GroupAuditEvents` holds `CONTRIBUTION_FINANCIALLY_SETTLED`, `CYCLE_READY_FOR_SELECTION`, `CONTRIBUTION_SETTLEMENT_REVERSED`, `CYCLE_FINANCIAL_SHORTFALL_REOPENED`. |

ID chain confirmed in PostgreSQL: Contribution → `Payments.ContributionId` → `ProviderOrderId` → `ProviderPaymentId` → `JournalId` → `ledger.JournalEntries.EventId = Payment.Id` → `JournalLines.PaymentId/ContributionId`.

## Offline coverage (FakePaymentGateway)

The automated suite still uses `FakePaymentGateway` and never contacts Razorpay. Existing tests cover invalid Checkout and webhook signatures, valid HMAC acceptance, duplicate event keys processed once, event-identity reuse with a different payload rejected, history/event immutability triggers, concurrent verify + duplicate webhooks + reconcile settling exactly once with one journal and one `PAYMENT_CAPTURED`, competing provider IDs not over-settling, authorized/failed events never settling or posting clearing, out-of-order failure/authorization not undoing capture, refund reversal with the selection boundary, partial-refund review, and Ledger-failure rollback. Two existing tests were extended in `PaymentEndpointTests.cs`: a webhook with no signature header is rejected with `INVALID_WEBHOOK_SIGNATURE`, and after a FAILED provider status the contribution remains payable (`canPay: true`, same payment, full remaining amount) while AUTHORIZED does not.

## Automated verification

| Check | Result |
|---|---|
| Backend Release build | PASS — 0 warnings, 0 errors (.NET SDK 10.0.400, `global.json` roll-forward) |
| Unit tests | PASS — 214 |
| Architecture tests | PASS — 14 |
| PostgreSQL integration tests (Testcontainers) | PASS — 180, including all payment cases |
| Frontend lint | PASS |
| Frontend typecheck | PASS |
| Frontend production build | PASS — member/admin payment routes generated; only the existing multiple-lockfile warning |
| EF pending-model-change check | PASS — Audit, Identity, Organizers, Groups, Ledger, Payments, Payouts: no changes |
| `git diff --check` | PASS |

## Secret scan

Exact-value comparison for the key secret, webhook secret, and public key ID against: tracked files at HEAD, the working tree, every reachable Git blob, untracked non-ignored files, `frontend/src`, and the `frontend/.next` production output — 0 matches for all three after `.env.example` was restored. The production bundle also contains no `rzp_live_`, `RAZORPAY_KEY_SECRET`, `Payment_RazorpayKeySecret`, `Payment_WebhookSecret`, or `WebhookSecret` strings. Backend and frontend logs from the run contain 0 matches for either secret. Scan output reports only file names and counts.

## Remaining limitations

- Public webhook delivery from the Razorpay Dashboard was not exercised; a public HTTPS tunnel or deployment is required. Webhook behavior is covered offline and the live route rejected unsigned/invalid requests.
- The smoke scenario used a 2-member Development group policy; production policy requires 20.
- Refund initiation remains outside the application (issued through the Razorpay TEST API); the application only observes and reverses.
- No Prompt 9 payout, RazorpayX, platform-fee, or production-mode operation was performed.
