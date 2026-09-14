# Prompt 8 final verification

Verified on 2026-09-13 against the existing Prompt 8 working tree. The payment backend and Checkout screens were continued, not restarted. No Prompt 9 features were added.

## Verification results

| Check | Final result |
| --- | --- |
| Backend restore | Passed, including NuGet audit; network-enabled restore was needed after adding the Payments architecture-test reference |
| Backend Release build | Passed, zero warnings and zero errors |
| Unit tests | 168 passed, zero failed/skipped |
| Architecture tests | 12 passed, zero failed/skipped |
| Full PostgreSQL integration suite | 130 passed, zero failed/skipped; includes all existing Prompt 1–7 tests and 29 payment tests |
| Offline payment tests | Passed, including settlement, failed/authorized payments, refunds, reconciliation, concurrency, SQL protections, and rollback |
| EF pending-model-change check | No pending changes in Audit, Identity, Organizers, Groups, Ledger, or Payments |
| Frontend lint | Passed |
| Frontend typecheck | Passed |
| Frontend production build | Passed; member and admin payment routes generated |
| `git diff --check` | Passed |
| Secrets | No detected secrets in working files or reachable Git history; no Razorpay secret references or known local secret values in frontend source/build output |
| Cleanup | Disposable test databases removed; isolated PostgreSQL cluster stopped; loopback port 55439 has no listener |

Final evidence is retained locally in ignored `.tools/prompt8-restore.log`, `prompt8-build.log`, `prompt8-all-tests.log`, `prompt8-ef.log`, `prompt8-lint.log`, `prompt8-typecheck.log`, `prompt8-frontend-build.log`, `prompt8-secret-scan.json`, `prompt8-diff-check.log`, and `prompt8-status.txt`. Each backend suite has `TestResults/prompt8-final.trx`. The initial payment-only run also passed 25 tests; the final full run includes four additional payment cases.

The frontend's first production build could not fetch the existing Inter font under restricted networking. A network-enabled retry passed. The final build also passed after the Checkout retry correction. Next.js retains its non-fatal warning about the repository-root and frontend lockfiles.

## Confirmed issues fixed during verification

- The existing models had no Prompt 8 migrations. Added the Groups, Ledger, and Payments migrations and their snapshots, preserving existing migrations.
- Payment history had EF guards but lacked PostgreSQL immutability protections. Added database triggers, foreign keys, transition guards, and deferred settlement consistency checks.
- The gateway abstraction existed, but there was no concrete offline gateway or payment test suite in the interrupted working tree. Added a test-only adapter and regression tests using real PostgreSQL and the production signature/parser code.
- The existing Checkout component was not mounted. Connected it to member contribution cards and contribution history; gateway cycle progress now displays financial settlement totals.
- Captured provider payments did not check that the provider order was paid. Contradictory order/capture status now requires reconciliation.
- A failed refund left a payment in `REFUND_PENDING`. It now returns to captured, preserves financial settlement, and ignores a late pending event for that failed refund.
- A validly signed webhook with missing required JSON properties returned a server error. Missing properties now return HTTP 400.
- A member retrying after a refund in the same mounted Checkout component could reuse the refunded attempt's idempotency key. Checkout now starts a fresh key when the prior settlement is refunded and no current payment exists.

## Migrations and storage

Migration order follows API startup: Groups, Ledger, then Payments, after the existing Identity/Organizers/Audit migrations.

| Module | Migration |
| --- | --- |
| Groups | `20260913093859_RazorpayTestPayments` |
| Ledger | `20260913093903_RazorpayTestPayments` |
| Payments | `20260913093907_RazorpayTestPayments` |

Payments owns `PaymentsDbContext`, schema `payments`, and its own `__EFMigrationsHistory`.

| Entity/table | Purpose |
| --- | --- |
| `Payment` / `payments."Payments"` | Durable order intent, authoritative amount, source references, provider IDs, state, settlement/journal links, and reconciliation outcome |
| `PaymentProviderEvent` / `payments."PaymentProviderEvents"` | Immutable event identity, payload hash, safe provider references, and final processing outcome |
| `PaymentHistory` / `payments."PaymentHistory"` | Append-only payment timeline and actor/action metadata |
| `PaymentRefund` / `payments."PaymentRefunds"` | Append-only observed provider refund states |

Groups adds collection mode and financial totals to cycles, plus settlement amount/status/payment reference to contributions. Ledger adds PaymentId and ContributionId line dimensions. The existing chart seeder adds account `1010`, Payment Gateway Clearing, idempotently.

## Gateway and collection strategy

`IPaymentGateway` isolates provider calls. `RazorpayPaymentGateway` uses `HttpClient` with backend-only Basic authentication against `https://api.razorpay.com/v1/`, a 15-second timeout, INR amounts in paise, and TEST-only configuration validation. Provider error payloads are not propagated to clients. Order creation is not automatically retried after an uncertain POST.

`FakePaymentGateway` exists only in the integration-test project. It keeps provider order/payment state in concurrent dictionaries, signs test payloads, and delegates signature validation and webhook parsing to production code. It is injected only into the disposable test host. It neither contacts Razorpay nor exposes a production fake-payment endpoint.

Collection modes are `MANUAL_TRACKING` and `RAZORPAY` at the API boundary. Existing groups default to manual tracking. Razorpay mode is restricted to platform-created groups and requires the backend enable flag when saving group configuration. Manual contribution records remain operational entries: they create neither Payment rows nor cash/clearing Ledger entries.

## Order, Checkout, and verification flow

1. The authenticated member requests eligibility or order creation for a contribution. The backend verifies ownership and locks the owning group, shared with contribution and selection operations.
2. It derives the entire outstanding amount from the persisted expected obligation and financial settlement; the request has no authoritative amount field. Integration tests submit a forged amount/currency and confirm the order still uses INR 2,500 / 250,000 paise.
3. A durable Payment intent is committed before contacting Razorpay. A receipt derived from its ID identifies the provider order. Idempotency keys and one unrefunded payment per contribution prevent duplicate order intents.
4. The provider's order amount, currency, receipt, identity, and supported status are checked before persistence. The browser receives only the public key ID, order ID, amount, currency, and safe payment view.
5. `PaymentCheckout` loads Standard Checkout, opens it after member confirmation, submits the returned order/payment/signature to the backend, and provides status refresh and payment details. Closing Checkout does not assert financial failure or success.
6. The backend computes HMAC-SHA256 over the stored server order ID plus `|` plus provider payment ID, using the key secret, with constant-time comparison. Invalid signatures are rejected. It fetches current provider payment and order data before applying settlement.

This strategy follows Razorpay's [Standard Checkout verification guidance](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).

## Webhooks, idempotency, and event ordering

The anonymous webhook endpoint reads the exact request-body bytes, with a 1 MiB limit, and verifies HMAC-SHA256 using the webhook secret before parsing. No raw webhook payload, signature, key secret, or webhook secret is stored in the payment tables.

`X-Razorpay-Event-Id` supplies the event key; SHA-256 of the raw body is the fallback. Unique provider/event keys and a transaction advisory lock deduplicate processing. Reuse of an event ID with a different body hash is rejected. Event insertion, settlement, Ledger, and audits commit together. Unknown orders or unsupported event types are recorded as ignored, without settlement.

The handler fetches current provider state and checks it against the event's identity/amount/currency. Captured/refunded payments do not regress on late authorized/failed observations. Reconciliation holds are sticky. Failed refund observations prevent late pending observations for the same refund from reopening pending state. See Razorpay's [raw-body, duplicate-delivery, and event-order guidance](https://razorpay.com/docs/webhooks/validate-test/).

## State machine and financial behavior

Normal progression is `CREATED → PENDING → AUTHORIZED → CAPTURED`, with capture allowed directly from pending or after a failed attempt. `FAILED` does not bind a successful provider payment ID and may be retried through the same order. `CANCELLED` is declared but has no implemented cancellation transition.

`CAPTURED → REFUND_PENDING → REFUNDED` represents refund observation; a full confirmed refund can also arrive directly from captured. A failed pending refund returns to captured. Contradictions produce `RECONCILIATION_REQUIRED` with a recorded mismatch; generic refresh cannot silently release this hold.

Only a verified capture financially settles a contribution. It atomically posts exactly one `PaymentCaptured` journal:

- Debit `1010` Payment Gateway Clearing.
- Credit `2000` Group Pool Liability.

Both lines carry PaymentId and ContributionId. Authorization and failure post no financial entries. The shared database transaction includes Payment, Contribution, cycle recalculation, Ledger, payment history, and audit. An injected Ledger failure proves these changes roll back together; a subsequent webhook can settle successfully.

For Razorpay cycles, all expected contributions must be financially settled. Manual records alone never make the cycle ready. One missing settled contribution keeps `COLLECTING_CONTRIBUTIONS`; the final settlement moves it to `READY_FOR_SELECTION`. Selection rechecks financially satisfied obligations. Manual-mode readiness continues using the existing operational rules.

## Concurrency, refunds, and reconciliation

Payment processing acquires the group row lock before the payment row lock. It also uses transaction advisory locks for provider payment IDs and event IDs. Database uniqueness covers order ID, successful payment ID, receipt, contribution/idempotency key, contribution/attempt number, and one unrefunded payment per contribution. Ledger enforces unique accounting event and reversal identities. Version concurrency tokens provide additional protection.

Tests cover concurrent order requests, Checkout verification plus webhook plus reconciliation, duplicate and distinct webhook IDs, competing successful provider payment IDs, repeated settlement, and concurrent refund webhook/reconciliation. Each capture settles once and cannot exceed the obligation.

Refund support observes provider-initiated refunds; it does not initiate refunds. A matching full refund before selection creates a new reversing journal, retains the original journal, clears the contribution's current settlement, and reopens the same cycle. Repeated refund processing does not duplicate the reversal. A new payment attempt is possible afterward. Pending/failed refunds retain settlement. Partial refunds, refunds before a locally recorded capture, or refunds after selection require review. A post-selection refund preserves the existing contribution and selection state and does not silently rewind the cycle.

Reconciliation finds the stored order or uniquely resolves an uncertain order by receipt, fetches its payments, and prefers a single successful payment over failed attempts. It checks order/payment identity, amount, currency, capture state, and order status. Multiple successful matches or mismatches require review. Provider lookup failures are recorded without altering existing settlement. Gateway capture is not proof of bank settlement.

## Database protections

- Payment event/history/refund rows reject UPDATE, DELETE, and TRUNCATE. Payment rows reject deletion/truncation and mutation of source identity, amount, provider identity, receipt, key, attempt, and creation snapshot.
- Bound provider IDs and completed capture/settlement/refund references cannot be rewritten. Completed status transitions cannot regress, and reconciliation holds cannot be cleared through ordinary updates.
- Foreign keys bind contributions, users, journals, reversal journals, and Ledger dimensions. Money/state check constraints restrict persisted values.
- Deferred triggers require capture and settlement to commit together, a matching contribution and exact two-line capture journal, and a linked reversing journal for refunds.
- Contributions require their matching current settled payment; settlement cannot be removed without refund. Cycle totals must match actual financial obligations; ready Razorpay cycles must be fully funded. Cycle collection mode and selected-cycle finances are protected.
- Existing Ledger immutability, balancing, reversal, uniqueness, and Prompt 1–7 contribution/selection/auction protections remain in force and their regression tests pass.

These protections govern ordinary application/DML operations. A database owner or superuser can alter schema or disable triggers; production role provisioning remains an operational concern.

## APIs and frontend

All paths below are relative to `/api/v1`.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/contributions/{contributionId}/payment-eligibility` | Contribution owner |
| POST | `/contributions/{contributionId}/payments` | Contribution owner; Idempotency-Key required |
| GET | `/payments` | Member's own history |
| GET | `/payments/{id}` | Payment owner |
| POST | `/payments/{id}/verify` | Payment owner |
| POST | `/payments/{id}/refresh` | Payment owner |
| POST | `/payments/webhooks/razorpay` | Anonymous route; valid webhook signature required |
| GET | `/admin/payments` | Admin/SuperAdmin |
| GET | `/admin/payments/{id}` | Admin/SuperAdmin |
| POST | `/admin/payments/{id}/reconcile` | Admin/SuperAdmin |

Frontend pages: `/payments`, `/payments/[id]`, `/admin/payments`, `/admin/payments/[id]`. Components: `PaymentCheckout`, `PaymentsPage`, and `PaymentDetailsPage`; service/types: `payment.service.ts` and `payment.ts`. Checkout appears in `/contributions` and the member's current contribution card on a group page. Payment details show timeline, reconciliation, and refund history; administrators can inspect provider events and linked Ledger journals.

## Configuration and secrets

For Docker Compose, put the Razorpay settings in the repository-root `.env` file. Compose forwards them only to the backend; `PAYMENTS_RAZORPAY_ENABLED` maps to `Payments__Razorpay__Enabled`. Fill the credentials before setting the enable flag to `true`, then run `docker compose up -d --build backend` from the repository root. This configuration wiring was added after the verification run in response to the local setup question.

When running the backend directly with `dotnet run`, set the backend process environment or use its configuration provider instead. ASP.NET Core does not automatically load `.env` files.

| Variable | Purpose |
| --- | --- |
| `Payments__Razorpay__Enabled` | Enable collection; defaults false |
| `PAYMENTS_RAZORPAY_ENABLED` | Root `.env`/Compose alias for the backend enable flag |
| `RAZORPAY_ENVIRONMENT` | Must be `TEST`; defaults TEST |
| `RAZORPAY_KEY_ID` | Public `rzp_test_…` Checkout key ID |
| `RAZORPAY_KEY_SECRET` | Backend-only API/signature secret |
| `RAZORPAY_WEBHOOK_SECRET` | Backend-only webhook signature secret |
| `ConnectionStrings__DefaultConnection` | Backend PostgreSQL connection |
| `Database__ApplyMigrations` | Apply module migrations on API startup |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API URL; no payment secret belongs here |
| `DHANVI_TEST_POSTGRES` | Optional isolated PostgreSQL test-server connection; otherwise tests use Testcontainers |

The secret scan covers tracked and untracked nonignored working files, all reachable Git blobs, frontend source, and `.next` output. It checks common credential/private-key patterns, Razorpay secret names in frontend output, fake signing values in frontend output, and exact known local secret values without printing those values. No findings or tracked local `.env` files were detected. This is a scoped scan, not a guarantee against every possible secret format. No credentials were added or committed.

## Repository state and limitations

The repository retains the pre-existing uncommitted Prompt 8 work plus verification fixes, migrations, tests, and this report. Nothing was committed or staged. Next.js regenerated `next-env.d.ts`. Temporary logs and database files remain ignored; no verification services remain running.

No real Razorpay account or browser transaction was exercised. The passing payment suite is offline with real PostgreSQL, production signature validation, and production webhook parsing. Production financial operation is intentionally disabled by TEST-only validation. Collection-mode creation is available through the backend API; the existing group form has no collection-mode selector. Refund initiation, automated reconciliation scheduling, manual resolution of sticky reconciliation holds, and historical webhook-secret rotation are not implemented. Partial refunds and post-selection corrections require explicit future handling.

Deferred Prompt 9 work remains payouts, winner bank transfers, auction-member benefit payouts, and platform fee settlement. Escrow, autopay, GST/tax, and new notification systems were not implemented.
