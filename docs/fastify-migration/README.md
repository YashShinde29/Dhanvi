# Dhanvi backend migration: ASP.NET Core → Fastify

Technology changed; business behavior did not. The Fastify service in `backend/` reproduces the .NET API's routes, request
and response contracts, error codes, transactions, row locks, idempotency and audit trails on the **same PostgreSQL schema**,
replaces Hangfire with BullMQ, and adds the requested digital auction closing sequence. The .NET code has been removed from
the repository; it remains available in git history (the commit before its removal).

- [Parity checklist](parity-checklist.md) — every audited behavior, where it lives now, how it is proven, known differences.
- [Database baseline](database-baseline.md) — adopting the existing schema, migrations owned by the new stack.
- [Cutover runbook](cutover-runbook.md) — switching writes, webhooks and jobs without dual processing.

## Architecture

```
user-web (3000) ─┐                    ┌── PostgreSQL  (financial source of truth: locks, triggers, NUMERIC)
admin-web (3001) ┴─► Fastify :3002 ───┼── Redis       (BullMQ queues only)
                       │              └── Razorpay TEST (orders, captures, refunds; webhooks over exact bytes)
                  BullMQ worker ──────── PostgreSQL (every job re-validates under row locks)
```

```
backend/
├── sql/baseline/0000_baseline.sql   schema as it existed at takeover (adopted, never re-run)
├── sql/migrations/0001_auction_closing_sequence.sql
└── src/
    ├── server.ts · worker.ts · app.ts          process entry points and app factory
    ├── config/        env (zod), database, redis, auth, payment, auction, groups
    ├── plugins/       request-context, error-handler, auth, cors, raw-body, swagger
    ├── routes/api/v1/ thin route modules: path + schema + policy → controller
    ├── features/      auth, organizer, group, cycle, contribution, random-draw, auction, ledger, payment, payout, admin, audit
    │                  (*.domain / *.repository / *.service / *.controller / *.schema)
    ├── queues/        auction.queue (open/closing/finalize/sweep), reconciliation.queue
    ├── workers/       auction.worker, reconciliation.worker
    ├── services/      auction-scheduler (state → next durable job), payout-gateway (FAKE provider)
    ├── infra/         database (pool wrapper, transactions, change tracking, migrator), razorpay, container, logger
    └── utils/         money (Decimal), json (exact numbers), dotnet-json (fingerprints), dates, enums, idempotency, crypto, errors
```

### Data layer choice: `pg` + parameterized SQL (Prisma evaluated, not used)

Nearly every write in Dhanvi is a lock-ordered transaction (`SELECT … FOR UPDATE` on the group, then cycle/auction/payment),
interacts with deferred constraint triggers, uses composite foreign keys and alternate keys, stores the group rules as EF-shaped
`jsonb`, and must not rewrite unchanged columns (immutability triggers, µs timestamps). Prisma would have needed raw SQL for
all of those paths, a second migration owner (drift against 50 triggers) and its own Decimal/connection engine. A thin typed
layer over one `pg` pool (`infra/database/db.ts`) keeps every lock and transaction explicit and reviewable.

## Digital auction closing sequence (new)

At the authoritative `EndsAt`, an open auction with a highest bid enters **GOING_ONCE → GOING_TWICE → FINAL_WARNING →
FINALIZING → COMPLETED** (durations: `AUCTION_GOING_ONCE_SECONDS`, `AUCTION_GOING_TWICE_SECONDS`,
`AUCTION_FINAL_WARNING_SECONDS`, default 30 s). A valid higher bid during the first three phases becomes highest and resets
to GOING_ONCE. With zero bids the auction closes with no winner (the existing outcome). Normal bidding inside the window is
unchanged — the call phases never appear after ordinary bids.

- Deterministic: phase deadlines are anchored to `EndsAt` / the previous deadline / the resetting bid's server time, and
  every bid transaction first materializes due transitions under the auction row lock. A late worker cannot change the result.
- Stale-safe: jobs carry `ClosingVersion` (and the highest bid id where relevant); the worker re-reads PostgreSQL and NO-OPs on
  mismatch. Deterministic job ids dedupe enqueueing; unique constraints make double finalization impossible.
- Durable: no `setTimeout`. A repeatable `AUCTION_SWEEP` rebuilds the next job from PostgreSQL (tested by deleting every Redis
  job mid-auction). Automated actions are attributed to the group owner (actor columns are foreign keys to real users) and
  also logged to `audit.audit_logs` with a null actor and the job id.
- UI: “Auction Ends In” with calm/amber/urgent emphasis plus text cues; “Going Once / Going Twice / Final Call /
  Finalizing... / Auction Completed” labels; 1 s polling during the call. Bid confirmation (Review bid → Confirm & Place Bid)
  is unchanged.

## Running locally

```bash
cp .env.example .env              # fill POSTGRES_*, JWT_SIGNING_KEY (≥32 chars), optional seed admin
docker compose up --build         # postgres, redis, api (migrates + seeds), worker, user-web :3000, admin-web :3001
```

Without Docker for the apps (PostgreSQL and Redis still required):

```bash
cd backend && npm ci && cp .env.example .env   # set DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY
npm run db:migrate && npm run db:seed
npm run dev                       # api :3002
npm run worker:dev                # worker (separate terminal, no port)
cd ../frontend && npm install && npm run dev   # user-web :3000, admin-web :3001 → NEXT_PUBLIC_API_URL=http://localhost:3002
```

Backend scripts: `dev`, `worker`, `build`, `start`, `start:worker`, `lint`, `typecheck`, `test` (unit), `test:integration`
(Testcontainers PostgreSQL 17 + Redis 7; Docker required), `test:all`, `db:migrate`, `db:seed`.
Swagger UI: `http://localhost:3002/swagger`.

## Tests

| Suite | What it proves |
| --- | --- |
| `test/unit/dotnet-json` | Fingerprint/request-hash serialization byte-identical to .NET 10 (golden values) |
| `test/unit/crypto` | Existing ASP.NET Identity hashes verify; HMAC exact-bytes check |
| `test/unit/random-draw` | DHANVI_RANDOM_V1 proofs accepted by the independent Python verifier |
| `test/unit/auction-closing` | Calculator and closing state machine (resets, boundaries, late workers) |
| `test/integration/identity` | Auth, cookies, JWT claims, refresh rotation, reset, organizer workflow, role checks |
| `test/integration/groups-cycles` | Four group types, concurrent final-slot approval, cycles, contributions, random draw |
| `test/integration/auctions` | Concurrent bids, full Final Call, resets, exact-boundary bid, stale & duplicate jobs, zero bids, auto-open, rescheduling |
| `test/integration/finance` | Razorpay capture/webhooks/refund/mismatch, ledger exactly once, payouts, cycle completion, trial balance |
| `test/integration/bullmq` | Real Redis + real time: open → closing → finalize; recovery after Redis loses every job |
| `docs/examples/random-v1-test-vector.json` (asserted in `test/unit/random-draw`) | Published golden random-draw vector reproduced exactly |

Before the .NET backend was removed, a contract-parity run executed the same 75-step scenario against both APIs on fresh
databases: 75/75 steps were identical in status codes, JSON keys, value types and error codes.
