# Prompt 6 final Windows verification

Final reporting completed on 2026-09-11 using the existing implementation and saved verification artifacts. The auction engine was not restarted or rewritten. Implementation details, formulas, APIs, UI, audit events, limitations, and deferred work are documented in [Auction engine](auction-engine.md).

## Saved final test evidence

Inspected `.tools/windows-final-tests.log` and the matching TRX files from 2026-09-09 before making changes. All suites used Release `net10.0` assemblies:

| Suite | Passed | Failed | Skipped | Total | TRX file under the suite's `TestResults` directory |
| --- | ---: | ---: | ---: | ---: | --- |
| Unit | 127 | 0 | 0 | 127 | `windows-final_net10.0_20260909215616.trx` |
| Architecture | 8 | 0 | 0 | 8 | `windows-final_net10.0_20260909215625.trx` |
| PostgreSQL integration | 80 | 0 | 0 | 80 | `windows-final_net10.0_20260909215711.trx` |

The separate `.tools/final-integration-tests.log` also records 80 passed, zero failed, and zero skipped. These are preserved test results, not a claim that the suites were rerun during final reporting.

The final TRX confirms both bid-versus-close lock orders, duplicate/concurrent close, atomic rollback on an injected allocation failure, immutable auction/bid/result/allocation history, and organizer-reserved Cycle 1 followed by Auction Cycle 2. The latter test explicitly prepares Cycle 2; it does not implement automatic advancement.

## Reconfirmed build and static checks

The original build/static-check transcripts were not present alongside the saved test logs, so these checks were repeated against the current repository:

| Check | Result |
| --- | --- |
| `dotnet build backend/Dhanvi.sln -c Release --no-restore` using the pinned .NET 10.0.302 SDK | Passed; zero warnings, zero errors |
| `npm run lint` in `frontend` | Passed, exit 0 |
| `npm run build` in `frontend` | Passed, exit 0; 22 static pages generated; member, organizer, and admin auction routes present |
| `npm run typecheck` in `frontend` | Passed, exit 0 |
| `migrations has-pending-model-changes --project backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure --context GroupsDbContext --configuration Release --no-build` using `.tools/dotnet-ef.exe` | Passed: `No changes have been made to the model since the last migration.` |
| `git diff --check` | Passed; no whitespace errors |

The first production-build attempt could not fetch Inter from Google Fonts under restricted network access. The authorized network-enabled retry succeeded without source changes. Next.js emitted a non-fatal workspace-root warning because both repository-root and frontend lockfiles exist. The configured font requires network access or a populated build cache.

## Migration verification

`20260909154641_AuctionEngine` exists with its designer metadata and the updated `GroupsDbContextModelSnapshot`. It is the sole Prompt 6 migration and adds `groups."Auctions"`, `groups."AuctionBids"`, `groups."AuctionResults"`, and `groups."AuctionBenefitAllocations"`. Existing selection tables are reused.

Read-only inspection of the local application's `groups."__EFMigrationsHistory"` found exactly the four checked-in Groups migrations, including AuctionEngine once. No checked-in Groups migration is unapplied to that database, and the EF model check found no pending model change. No new or duplicate migration was generated.

## Timezone confirmation

- Actual event timestamps and scheduled auction instants use UTC; the migration maps them to PostgreSQL `timestamp with time zone`.
- Prompt 3's published `AuctionStartTime` and `AuctionEndTime` remain UTC clock-time configuration. The cycle's `SelectionDate` supplies the calendar label. These values are not reinterpreted as Asia/Kolkata clock times.
- `AuctionPanel` formats the window, bids, and audit timestamps with `group.groupTimeZone`; `AuctionResultCard` receives the same configured zone. The UI displays the full local date and time.
- A 10:00 UTC start displays as 15:30 in Asia/Kolkata. A late UTC window can display on the following local calendar day. Saved passing tests include `UtcConfigurationIsNotReinterpretedAsIst` and `LateUtcWindowDisplaysTheFollowingLocalCalendarDay`.
- Contribution and due dates retain Prompt 4's business-calendar semantics in `GroupTimeZone`. No hidden UTC/Asia-Kolkata conversion change was introduced.

## Cleanup and repository state

The isolated verification cluster at `.tools/pg18-test-data`, configured for loopback port 55439, was already stopped: `pg_ctl status` reported no server running and the port had no listener. Docker inspection found only the three application Compose containers; no temporary test containers remained. No temporary verification service required stopping or removal. Saved logs and test data were retained.

Initial `git status --short` showed only the existing `frontend/next-env.d.ts` development-route references. The production build regenerated this file; its initial contents were restored afterward. The only final-report addition is this missing verification document, already linked by the README and auction documentation. No feature source, financial behavior, or migration was changed during final reporting.
