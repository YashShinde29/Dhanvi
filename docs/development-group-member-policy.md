# Development group member policy ? verification report

1. **Files that previously contained the hardcoded 20-member minimum**

- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Infrastructure/AuctionPersistence.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Domain/Group.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/CyclePersistence.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/GroupsDbContext.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909045323_GroupsAndMembershipFoundation.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909045323_GroupsAndMembershipFoundation.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909051922_MonthlyCyclesAndContributionTracking.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909051922_MonthlyCyclesAndContributionTracking.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909100752_RandomAndReservedSelectionFoundation.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909154641_AuctionEngine.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260909154641_AuctionEngine.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260913093859_RazorpayTestPayments.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260914061232_PayoutCycleCompletion.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/GroupsDbContextModelSnapshot.cs`
- `backend/tests/Dhanvi.UnitTests/Auctions/AuctionTests.cs`
- `backend/tests/Dhanvi.UnitTests/Groups/GroupTests.cs`
- `frontend/src/features/groups/group-wizard.tsx`
- `frontend/src/lib/errors.ts`

`Group.cs` enforced capacity in contribution calculation and rule validation, called by create, update, publish, activation, and auction calculations. `GroupTests.cs` explicitly rejected 19; `AuctionTests.cs` began its supported-capacity coverage at 20. The EF configuration and historical migration snapshots persisted the minimum. The frontend wizard and error mapping enforced/displayed it. `docs/groups-foundation.md` describes the original 20?50 rule; that historical description is preserved.

All backend, frontend, EF configuration, migrations, constraints, tests, docs, and repository configuration were searched. Other uses of 20 are fixture sizes, money examples, pagination, display data, or unrelated character limits. `GroupsEndpoints.cs` has a member-filter parsing default of 20, not a minimum check. `AuctionCalculator.cs` enforced the minimum indirectly through `GroupRules.Contribution` and now accepts the supplied policy.

2. **Files changed or added for this request**

- `backend/src/Dhanvi.Api/appsettings.Development.json`
- `backend/src/Dhanvi.Api/appsettings.Test.json`
- `backend/src/Dhanvi.Api/appsettings.Testing.json`
- `backend/src/Dhanvi.Api/appsettings.json`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Application/AuctionQueries.cs`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Application/AuctionService.cs`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Domain/Auction.cs`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Domain/AuctionCalculator.cs`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Domain/AuctionResult.cs`
- `backend/src/Modules/Auctions/Dhanvi.Modules.Auctions.Infrastructure/AuctionPersistence.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Domain/Group.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Domain/GroupMemberPolicy.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/GroupPolicyOptions.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/GroupsModule.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/CyclePersistence.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/GroupsDbContext.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260914110345_DevelopmentGroupMemberRange.Designer.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/20260914110345_DevelopmentGroupMemberRange.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Persistence/Migrations/GroupsDbContextModelSnapshot.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Services/GroupCycleService.cs`
- `backend/src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure/Services/GroupService.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/AuctionEndpointTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/CycleEndpointTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/GroupEndpointTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/GroupPolicyConfigurationTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/PayoutEndpointTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Api/SelectionEndpointTests.cs`
- `backend/tests/Dhanvi.IntegrationTests/Database/GroupMemberConstraintTests.cs`
- `backend/tests/Dhanvi.UnitTests/Auctions/AuctionTests.cs`
- `backend/tests/Dhanvi.UnitTests/Groups/GroupTests.cs`
- `docs/development-group-member-policy.md`
- `frontend/.env.development`
- `frontend/.env.example`
- `frontend/.env.test`
- `frontend/src/features/groups/group-wizard.tsx`
- `frontend/src/lib/env.ts`
- `frontend/src/lib/errors.ts`
- `frontend/tests/group-policy.test.mjs`

The workspace already contained Prompt 8?9 edits. They were preserved, including existing changes in files touched by this request. Historical migrations, especially the Prompt 3 foundation migration and designer, were not edited. Build logs and generated outputs are ignored artifacts.

3. **Configuration introduced**

| Configuration | Development / Test / Testing | Production and other environments |
|---|---|---|
| `GroupPolicy:MinimumMembers` | `2` | `20` |
| `GroupPolicy:MaximumMembers` | `50` | `50` |
| `NEXT_PUBLIC_MIN_GROUP_MEMBERS` | `2` in `.env.development` and `.env.test` | Defaults to `20`; production builds enforce `20` even if set to `2` |

Backend environment-variable equivalents are `GroupPolicy__MinimumMembers` and `GroupPolicy__MaximumMembers`. Base `appsettings.json` retains 20/50; environment files set 2/50. The infrastructure resolver rejects attempts to change production or staging to development limits. Pure domain entities receive an immutable `GroupMemberPolicy`, with production as the default; they have no ASP.NET configuration dependency. The frontend uses the central values for initial form capacity, input attributes, validation and error messages. Frontend public values are fixed at build time; use `npm run dev` for the development configuration. Production `npm run build` retains 20.

4. **New migration**

`20260914110345_DevelopmentGroupMemberRange`

5. **Database constraint before / after**

| Table / check | Before | After |
|---|---|---|
| `groups."Groups"` / `CK_Group_Rules` | `(Rules->>'MemberLimit')::int BETWEEN 20 AND 50` | `(Rules->>'MemberLimit')::int BETWEEN 2 AND 50` |
| `groups."MonthlyCycles"` / `CK_Cycle_Expected` | `ExpectedMemberCount BETWEEN 20 AND 50` | `ExpectedMemberCount BETWEEN 2 AND 50` |
| `groups."Auctions"` / `CK_Auction_Rules` | `MemberLimit BETWEEN 20 AND 50` | `MemberLimit BETWEEN 2 AND 50` |
| `groups."AuctionResults"` / `CK_AuctionResult_Money` | `MemberLimit BETWEEN 20 AND 50` | `MemberLimit BETWEEN 2 AND 50` |

`BETWEEN` includes both endpoints, so the new safe range is `>= 2 AND <= 50`. All other clauses, including positive value, exact monthly contribution and duration equality, remain unchanged. The migration test queries `pg_get_constraintdef` before and after, verifies the only change is 20?2 in these ranges, preserves an existing 20-member group, inserts a 2-member group, and proves direct SQL cannot store 1 or 51 members with otherwise valid money/duration values. Migration verification uses disposable PostgreSQL 18 databases. No persistent application or production database was migrated. Downgrading restores 20?50 and therefore requires any smaller development groups to be removed first.

6. **Development minimum**

2 members; maximum 50.

7. **Production minimum**

20 members; maximum 50. Explicit configuration guards and production-default domain calls preserve this rule.

8. **Tests changed / added**

- `GroupTests.cs`: Development/Test boundaries 1 invalid, 2/3/50 valid, 51 invalid; production 19 invalid, 20/50 valid, 51 invalid. Checks exact `MonthlyContribution = GroupValue / MemberLimit`, `DurationMonths = MemberLimit`, create/update/publish/activate policy propagation, production revalidation and the organizer's one remaining external slot.
- `AuctionTests.cs`: allocation coverage across the complete supported capacity range for both policies; existing production examples retained.
- `GroupPolicyConfigurationTests.cs`: environment defaults, configuration binding, fixed maximum, safe-range guards, and rejection of development limits in production/staging.
- `GroupEndpointTests.cs`: configured Testing API create/update/publish boundaries and derived values.
- `CycleEndpointTests.cs`: real PostgreSQL activation of two-member platform Random, organizer-reserved Random, and Auction groups; exactly two cycles and four contributions, with correct amounts and idempotent activation. Existing 20/50 cases retained.
- `SelectionEndpointTests.cs`: two-member organizer-reserved selection chooses the organizer without consuming random entropy; existing Random/Auction production-sized cases retained.
- `PayoutEndpointTests.cs`: two-member Random organizer-first payout prepares the full pool, uses an independent administrator for approval/execution, settles successfully, and opens the final Random cycle while retaining all four contribution obligations.
- `AuctionEndpointTests.cs`: two-member platform and organizer groups open, bid, close, persist results/allocations, and conserve money. Existing 20-member cases retained.
- `GroupMemberConstraintTests.cs`: database migration and safe-range verification described above.
- `frontend/tests/group-policy.test.mjs`: four configuration tests covering Development/Test files, production overrides, missing values and invalid values. Run with `node --test tests/group-policy.test.mjs` from `frontend`.

9. **Verification results**

| Check | Result |
|---|---|
| Backend Release build | PASS ? .NET 10.0.302, zero warnings/errors |
| Backend unit tests | PASS ? 202, zero failed/skipped |
| Architecture tests | PASS ? 14, zero failed/skipped |
| PostgreSQL integration tests | PASS ? 179, zero failed/skipped |
| Frontend policy tests | PASS ? 4 |
| Frontend lint | PASS |
| Frontend typecheck | PASS |
| Frontend production build | PASS ? all routes generated; existing multiple-lockfile workspace-root warning |
| EF pending model changes | PASS ? Audit, Identity, Organizer, Groups, Ledger, Payments and Payouts contexts |
| `git diff --check` | PASS |
| Historical Prompt 3 migration/designer diff | Unchanged |

The normal system `dotnet` is .NET 9; verification used the existing repository `.dotnet/dotnet.exe` (.NET 10), without changing target frameworks. The frontend build was retried with network access to fetch its existing Inter Google font; no font or application-layout changes were made. PostgreSQL tests used an isolated loopback PostgreSQL 18 cluster and disposable databases. The final backend run passed all 395 tests.

Local evidence: `.tools/member-policy-build.log`, `.tools/member-policy-tests-final.log`, `.tools/member-policy-focused.log`, `.tools/member-policy-lint.log`, `.tools/member-policy-typecheck.log`, `.tools/member-policy-frontend-build.log`, `.tools/member-policy-ef-all.log` (Groups/Ledger/Payments/Payouts), `.tools/member-policy-ef-required-config.log` (Audit/Identity/Organizer), `.tools/member-policy-diff-check.log`, and each backend test project's `TestResults/member-policy-final.trx`. The EF contexts that require a connection string were rerun with the isolated test-server configuration.

The full backend regression run includes existing Prompt 1?9 unit, architecture, API, payments, ledger, selection and payout behavior. No tests were deleted and no unrelated feature changes were made.
