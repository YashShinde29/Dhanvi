# Cutover runbook (.NET → Fastify)

Goal: switch writes, webhooks and background work to the Fastify stack with **no window in which both stacks process the
same financial events or auction steps.** The .NET source has been removed from the repository; if a production rollback
path is needed, build the old API from the git commit before its removal and keep that image available until the cutover
has been verified.

## Before the cutover window

1. Deploy PostgreSQL backup/PITR and confirm a restore works.
2. Deploy the Fastify API and worker **stopped** (or API only, with `AUCTION_AUTOMATION_ENABLED=false`), pointing at the
   production database and a production Redis (AOF enabled). Use the same `JWT_SIGNING_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`:
   access tokens and refresh tokens issued by either stack keep working, so users stay signed in.
3. Run `npm run db:migrate` once. On the existing database it **adopts** the baseline and applies only `0001` (additive).
4. Production config checks: `NODE_ENV=production` (forces the 20–50 member policy), `JWT_SECURE_COOKIES=true`,
   `SWAGGER_ENABLED=false` (optional), Razorpay TEST credentials only, `PAYOUTS_PROVIDER=FAKE`.

## Cutover (in order)

1. **Freeze .NET writes:** put the .NET API behind maintenance (or scale to zero). There are no Hangfire jobs to drain
   (the .NET app registered Hangfire but enqueued nothing), but stop its Hangfire server so nothing new appears.
2. **Webhook:** in the Razorpay TEST dashboard change the webhook URL to `https://<api>/api/v1/payments/webhooks/razorpay`
   (same secret). Never point Razorpay at both stacks.
3. Start the Fastify **API**, then the **worker** (`AUCTION_AUTOMATION_ENABLED=true`). The worker registers the auction sweep
   once cluster-wide; within one sweep interval it schedules the next step for every ready or open auction. Scheduled
   auctions whose window starts in the future get their `OPEN_AUCTION` job; no existing data is regenerated.
4. **Switch the web apps:** set `NEXT_PUBLIC_API_URL` (both apps) to the Fastify API origin (or keep it empty and point `API_PROXY_TARGET` at it) and redeploy. Routes, payloads and
   error codes are unchanged (75/75 contract parity), so no other frontend change is needed for existing screens.
5. Verify (smoke, ~10 minutes):
   - `GET /api/v1/health` and `/health/ready`.
   - Sign in on both apps; refresh a session; admin overview loads.
   - BullMQ: `auction` queue shows the `AUCTION_SWEEP` scheduler; delayed `OPEN_AUCTION` jobs exist for ready auctions.
   - Payments: open the admin reconciliation page; reconcile one recent payment (should be `MATCHED`).
   - Ledger: trial balance `balanced: true`.
   - Payouts: list loads; if any payout is `PROCESSING`, run reconcile once.
6. Unfreeze: route all traffic to Fastify. Keep the .NET deployment stopped (do not delete).

## Rollback

Stop the Fastify worker first (no new auction transitions), then the API; restore the Razorpay webhook URL and the web apps'
API URL to the previous .NET deployment (image built from git history); start it. The schema change in `0001` is additive
and ignored by .NET. Auctions that went through an automatic closing sequence remain valid history (status/winner columns
are the ones .NET already reads).

## Rules that must hold at all times

- Exactly one stack receives Razorpay webhooks.
- Exactly one stack runs auction automation (only Fastify has it) and payout/reconciliation actions.
- Redis is never treated as financial truth: losing Redis loses only scheduling hints, which the sweep rebuilds from PostgreSQL.
