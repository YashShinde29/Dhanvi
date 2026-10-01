# Database baseline and migrations

PostgreSQL remains the financial source of truth. The Fastify stack maps onto the **existing** schema; it does not rename
tables or columns, recreate financial tables, regenerate cycles, or rebuild ledger history.

## Baseline

`backend/sql/baseline/0000_baseline.sql` is a `pg_dump --schema-only` of a fresh PostgreSQL 17 database after the former
.NET API applied **all** of its EF Core migrations (Identity, Organizers, Audit, Groups ×8, Ledger ×2, Payments,
Payouts), plus the reference rows they create (roles, chart of accounts) and the EF `__EFMigrationsHistory` rows. It contains
45 tables in 7 schemas and every trigger those migrations installed (append-only history, payment/payout state guards,
deferred journal-balance and settlement-consistency constraint triggers). Historical EF migrations were **not** rewritten.

## How `npm run db:migrate` decides

`src/infra/database/migrator.ts`, under a PostgreSQL advisory lock (safe with several instances):

| Database state | Action |
| --- | --- |
| Existing Dhanvi DB (`identity.users` exists) | Records the baseline as **adopted**. The baseline SQL is never executed; no table is touched. |
| Empty DB (local, tests) | Executes the baseline once. |
| Always | Applies `backend/sql/migrations/*.sql` in order, each in its own transaction, recorded with a SHA-256 checksum in `dhanvi_meta.schema_migrations`. A modified, already-applied file aborts the run. |

Verified both paths: adopting a database created by the old migrations applied only `0001` and left existing rows intact; a fresh database
built from the baseline produced a schema identical to the adopted one (modulo PostgreSQL's re-deparsing of CHECK
expressions).

## Migrations owned by the new stack

| File | Change | Compatibility |
| --- | --- | --- |
| `0001_auction_closing_sequence.sql` | Adds `ClosingPhase`, `ClosingPhaseEndsAt`, `ClosingStartedAt`, `ClosingVersion` to `groups."Auctions"`, a CHECK constraint, and an index for the scheduler sweep. | Additive; EF writes only mapped columns, so the legacy API keeps working. Status stays `Open` during the closing sequence, so existing bid/terminal triggers are unchanged. |

Future schema changes: add `0002_….sql` etc. Never edit the baseline or an applied migration.

## Writing rules the code follows

- One `pg` pool per process (`config/database.ts`); every feature uses it through `infra/database/db.ts`.
- `NUMERIC` → `Decimal`, never `number`. `DATE` stays `YYYY-MM-DD`. Sessions run in UTC.
- Updates write **only changed columns** (`infra/database/changes.ts`). This matters: several triggers reject rewriting
  identity columns (e.g. `payment_protected` on `CapturedAt`), and rewriting µs timestamps written by the previous backend with
  millisecond JS values would silently change history.
- Locks: `SELECT … FOR UPDATE` in the same order as before (group → cycle → auction / contribution / payment / payout) and the
  same transaction-scoped advisory locks (`hashtextextended(key, seed)`) for provider keys, beneficiaries and events.
