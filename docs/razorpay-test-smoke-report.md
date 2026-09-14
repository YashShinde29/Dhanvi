# Razorpay TEST incoming contribution verification

The actual Razorpay TEST payment could not be attempted: none of the six required exported variables was visible to the process executing this task. The external smoke-test portion was stopped before any Razorpay API call. No real order, payment, refund, or provider event was created. No credential values were printed or copied into files.

## Environment detection

| Required variable | Process visibility |
|---|---|
| `Payment_RazorpayEnabled` | MISSING |
| `Payment_RazorpayKeyId` | MISSING |
| `Payment_RazorpayKeySecret` | MISSING |
| `Payment_RazorpayCheckoutReturnBaseUrl` | MISSING |
| `Payment_WebhookEnabled` | MISSING |
| `Payment_WebhookSecret` | MISSING |

These names need to be inherited by the process launching the existing backend. No request to paste or reveal their values is necessary. A variable exported into a separate terminal does not alter an already-running parent process or its other children.

## Minimal integration fixes

- `PaymentsModule.cs` now binds the six exact names. Explicit values, including `false`, take precedence over the older `Payments:Razorpay:Enabled` / `RAZORPAY_*` names. Legacy configuration remains supported.
- `RazorpayGateway.cs` binds/validates the optional return base URL and webhook switch while retaining the TEST environment and `rzp_test_` key restriction. Invalid configured return URLs fail validation. The key secret and webhook secret remain independent backend options. Webhook verification rejects requests when disabled.
- `PaymentService.cs` rejects a disabled webhook before signature parsing, provider lookups or financial mutations.
- `GroupService.cs` recognizes `Payment_RazorpayEnabled` when validating Razorpay collection mode, so enabling the payment module also enables eligible group creation through the existing API.
- `payment-checkout.tsx` explicitly passes the internal Payment ID in Checkout notes, alongside the existing backend order ID, amount, INR currency and public TEST key. No secrets are added to the Checkout response or frontend.
- `RazorpayConfigurationTests.cs` tests all six names, environment-provider handling of single underscores, alias precedence, startup validation, TEST-only guards, separate signature secrets and webhook disabling using synthetic fixtures only.
- `PaymentConfigurationEndpointTests.cs` checks disabled webhook routing without parsing or settlement.
- `IdentityApiFixture.cs` isolates offline API tests from inherited manual-smoke credentials. Existing contribution payment tests retain `FakePaymentGateway`.

The backend is the existing modular monolith, `Dhanvi.Api`, not a separate payment-service executable. `WebApplication.CreateBuilder(args)` includes exported process environment variables, and `AddPaymentsModule` uses that configuration with `ValidateOnStart`. `dotnet run` does not automatically load `services/.env` or the repository `.env`. No dotenv loader, new startup workflow, payment redesign, payout changes, or migration was introduced.

The existing backend command remains `dotnet run --project backend/src/Dhanvi.Api`, using .NET 10 and the already-required PostgreSQL/JWT settings. The existing frontend command remains `npm run dev` from `frontend`. This verification used the repository's installed .NET 10 SDK because the system default SDK is .NET 9.

## Checkout and return URL

The existing Checkout flow uses the JavaScript `handler` to POST the three Razorpay response fields to the authenticated backend verification endpoint. It does not use a redirect callback, and the repository has no `/checkout/return` route. The supplied return-base setting is now bound and validated, but it does not change this flow or establish a new callback endpoint. Razorpay documents the handler and callback-URL approaches separately; adding a callback URL would bypass the existing handler. [Razorpay Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).

Code inspection confirms that order creation accepts a contribution ID and idempotency key, not a caller-provided amount. The backend reads the eligible member contribution and creates the order from its outstanding amount. Checkout receives a `CheckoutView` containing the internal Payment ID, backend ProviderOrderId, amount in minor units, currency and public key. Key Secret and Webhook Secret are not in that DTO.

Verification checks the persisted order ID, the HMAC over persisted order ID and supplied payment ID, fetched provider identity/order/amount/currency/captured state, and the immutable internal amount. Only a verified provider capture settles the contribution. A frontend callback alone is not settlement. Reconciliation mismatches remain on hold rather than being silently corrected.

## Requested smoke-test results

| Item | Result |
|---|---|
| Exported variables detected | No ? all six names listed above are missing |
| Razorpay gateway startup | Real-credential startup blocked; enabled TEST configuration and startup validation pass with synthetic offline fixtures |
| Payment-service URL | Existing backend URL: `http://localhost:5000`; no persistent API process was launched for the blocked smoke test |
| Frontend URL | Existing development URL: `http://localhost:3000`; no persistent frontend process was launched for the blocked smoke test |
| Actual Razorpay TEST order | NOT ATTEMPTED ? missing environment |
| Internal Payment ID | None created for an external smoke test |
| Razorpay Order ID | None created for an external smoke test |
| Actual Checkout | NOT OPENED ? no real TEST order; integration inspected |
| Backend signature verification | Existing logic inspected; synthetic signature/API regressions tested offline |
| Authoritative payment status | No external payment; offline provider capture verifies `CAPTURED` |
| Contribution financial settlement | No external settlement; offline tests verify `FinanciallySettledAmount` and capture linkage separately from manual recorded status |
| Ledger journal | No external journal; offline tests verify exactly one capture journal, debit payment-gateway clearing / credit group-pool liability, exact amount and balanced lines |
| Reconciliation | No actual Razorpay lookup; offline matching, mismatch holds and repeated reconciliation verified |
| Webhook route | `/api/v1/payments/webhooks/razorpay`; offline route/signature/disabled-switch tests |
| Public webhook delivery | NOT TESTED; no public endpoint or tunnel created |
| Refund | No external refund; existing offline full-refund/reversal and post-selection protections retained |
| Duplicate events / idempotency | Offline regression tests; real-provider duplicates NOT TESTED |
| Concurrency | Offline PostgreSQL order/verification/webhook/reconciliation concurrency tests; no real-provider concurrency test |

## Automated verification

| Check | Result |
|---|---|
| Backend Release build | PASS ? zero warnings/errors, .NET 10.0.302 |
| Unit tests | PASS ? 214 |
| Architecture tests | PASS ? 14 |
| PostgreSQL integration tests | PASS ? 180 |
| Payment-specific cases included above | PASS ? 25 unit/configuration and 30 API integration cases |
| Frontend lint | PASS |
| Frontend typecheck | PASS |
| Frontend production build | PASS ? existing multiple-lockfile workspace-root warning only |
| EF pending-model check | PASS ? all seven contexts; no model changes |
| `git diff --check` | PASS |

All 408 backend tests passed, with zero failures or skips. The payment-specific cases are included in these totals. There is no separate payment-service test project. Tests use synthetic credentials, fake provider state and disposable PostgreSQL databases; they do not call Razorpay. The frontend build used network access only for its existing Google font download.

Evidence is retained in ignored `.tools/razorpay-env-build.log`, `razorpay-env-tests.log`, `razorpay-env-lint.log`, `razorpay-env-typecheck.log`, `razorpay-env-frontend-build.log`, `razorpay-env-ef.log`, `razorpay-env-diff-check.log`, `razorpay-env-secret-scan.json` and each backend test project's `TestResults/razorpay-env.trx`.

## Secret scan

No non-fixture Razorpay key patterns or frontend secret identifiers/fixture-secret strings were found in the repository/static-bundle scan. Exact comparison against the user's three credential values is UNAVAILABLE because those environment variables are missing. This is a limited structural scan, not proof against unavailable values. No actual credential was available to write into the repository, logs or bundle.

The actual credential values were unavailable, so an exact-value comparison against them cannot be claimed. Repository and bundle scans report only filenames/statuses, never matched contents. No screenshots, signatures, full sensitive payloads, or real credential values are included in this report.

## Remaining limitation

The intended end-to-end real Razorpay TEST incoming contribution payment remains unverified until the six exact variables are visible to the backend-launching process. After that environment issue is resolved, the existing eligible contribution ? Checkout ? backend verification ? captured settlement flow still needs to be exercised against Razorpay TEST, followed by inspection of the actual PostgreSQL rows. Public webhook delivery and actual refund/reconciliation remain untested. No production payment or Prompt 9 payout operation was performed.
