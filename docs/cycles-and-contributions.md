# Monthly cycles and contribution tracking

This describes Prompt 4. [Prompt 5](random-and-reserved-selection.md) now implements random/organizer-reserved selection and blocks contribution reversals once selection completes. Earlier selection-related limits below are historical where superseded.

Prompt 4 adds controlled activation and operational contribution tracking to the existing modular monolith. **No real payment is processed.** A Contribution is an expected monthly obligation; a ContributionEntry is an operational manual record or reversal. Neither is a payment nor a financial ledger entry.

## Architecture and changes

New domain projects: `Dhanvi.Modules.Cycles.Domain` and `Dhanvi.Modules.Contributions.Domain`. Cycles own schedule generation and cycle states; Contributions own obligations, recording, reversal, and overdue behavior. Groups Application exposes `IGroupCycleService` and `IContributionRecordingService`. Groups Infrastructure orchestrates these domains inside its existing PostgreSQL transaction/DbContext boundary, preserving atomic activation and the group-row locking established in Prompt 3. Identity and Organizer data are accessed through application contracts. No Payment/Ledger dependency or separate service is introduced.

`Group` adds `GroupTimeZone`, `ActivatedAt`, `CurrentCycleNumber`, controlled activation, active suspension, and a domain guard against post-activation member removal. Approved memberships become `ACTIVE` on activation. `GroupAuditEvent` adds an optional subject ID linking a contribution/cycle event to its subject without placing references or notes in audit logs. SharedKernel adds a business-rule error type, `BusinessCalendar`, and a reusable operation receipt (`IdempotencyRecord`).

## Activation

`POST /api/v1/groups/{groupId}/activate` requires the owning approved organizer for organizer groups, or admin/super-admin for platform groups. Admin can inspect every group, but there is no implicit admin override for recording/activation of someone else's organizer group.

A PostgreSQL transaction first locks the group row using `SELECT … FOR UPDATE`. It validates READY_TO_START, exact approved membership capacity, slots, accepted current rule version/hash (including persisted acceptance records), current organizer approval, valid start date, absence of cycles, duration = member limit, and exact expected pool:

`MonthlyContribution × MemberLimit = GroupValue`.

Stored group columns must agree with the accepted current configuration. The complete cycle schedule, every membership/cycle contribution obligation, membership activation, group activation, and audit events commit together. Any error rolls back all of them. The integration suite injects a database insert failure to verify this rollback.

A successful retry while the group is ACTIVE returns the same persisted schedule after authorization and schedule-count consistency checks. Concurrent activations serialize on the group row. No partial schedule is silently repaired.

## Schedule, dates, and timezone

The full schedule contains `DurationMonths` cycles and `MemberLimit × DurationMonths` obligations: 400 for 20 members, 2,500 for 50 members. Each expected contribution is the backend-calculated monthly amount; each expected pool equals group value.

Groups persist the initial platform timezone `Asia/Kolkata`. Existing groups receive that default in the migration. Timezone selection/editing is not exposed in this MVP. Newly published snapshots include the timezone; older snapshots remain untouched and inherit the documented platform default. `BusinessCalendar` centralizes conversion from the existing `IDateTimeProvider.UtcNow`; actual event timestamps remain UTC. API date-only values represent calendar dates in the group's timezone. Optional auction time configuration from Prompt 3 remains configuration only; no auction execution is introduced.

Scheduling days remain ordered and restricted to 1–28. The first contribution due date is the configured due day **on or after StartDate**. If that day has already passed within StartDate's month, the first cycle uses the next month. Later cycles add one calendar month; selection and payout dates use that cycle's month. This handles February and year boundaries without clamping dates. Activation permits StartDate today or in the future in the group timezone; an expired start date requires replacement of the immutable published group.

Cycle 1 opens immediately at activation even if its due date is in the future. Later cycles remain UPCOMING. No background process opens Cycle 2.

Selection method is persisted configuration only: all normal cycles are RANDOM or AUCTION according to the group. If organizer first payout is configured, only cycle 1 is ORGANIZER_RESERVED. It still stops at READY_FOR_SELECTION; no winner, discount execution, or payout is recorded.

## State machines and totals

Cycle flow: `UPCOMING → COLLECTING_CONTRIBUTIONS → CONTRIBUTIONS_COMPLETE → READY_FOR_SELECTION`. The final two transitions occur in the same transaction, with both timestamps persisted and separate audit events. Later selection/payout/completion statuses are enum placeholders only.

Cycle readiness requires every contribution to match its expected amount, the number of complete obligations to equal expected members, and the recorded total to equal expected pool. No shortfall funding, waiver, penalty, or default recovery is invented.

Cycle totals are persisted summaries. Every record or reversal reloads all cycle obligations while holding the group lock and recalculates recorded amount and fully recorded member count in the **same transaction** as the entry and receipt. A unique partial index permits only one collecting/complete/ready cycle per group.

Contribution states:

| Condition | Status |
| --- | --- |
| No recording yet | PENDING |
| Positive amount below expected | PARTIAL |
| Recorded amount equals expected | RECORDED |
| Business date after due date and amount below expected | OVERDUE |
| Recorded amount becomes zero through reversal, before/on due date | REVERSED |

An overdue shortfall takes precedence over PARTIAL/REVERSED. Fully recorded contributions never become overdue. `MarkOverdueAsync` is available through a controlled operation, not a scheduled job. It examines only the currently collecting cycle of an active group, never future cycles. Repeated overdue commands make no further changes to already-overdue rows.

## Manual recording, idempotency, and reversals

Recording requires the owning approved organizer or platform admin, ACTIVE group, matching group/cycle/contribution IDs, and a collecting cycle. Amount must be positive decimal currency with at most two places and cannot exceed the remaining expected amount. Reference is required (maximum 200 characters); optional note is limited to 1,000 characters.

Both record and reversal require an `Idempotency-Key` header (maximum 200 characters). The receipt is scoped to the group. A SHA-256 request fingerprint includes group, cycle, contribution, actor, operation, and payload. Same key and same request returns the original entry without another mutation, even when the original record completed the cycle. Reusing the key with a different payload returns `IDEMPOTENCY_KEY_REUSED`. Receipts do not expire in this foundation. A unique manual reference per contribution additionally rejects accidental duplicate recording under a different key. Keys/references are case-sensitive; clients should retry the exact request unchanged.

The frontend preserves the same key and payload across a failed/network-uncertain operation retry. Successful requests are followed by a refresh of the summaries and history.

Reversal request: `{ "entryId": "original-record-id", "reason": "Incorrect manual record" }`. It reverses the entire selected original entry, never silently edits an amount. A new positive-valued REVERSAL entry points to the RECORD entry; the summary subtracts that amount. Each original entry can be reversed only once. Reversing a reversal or another contribution's entry is rejected. Partial correction can be done by reversing a selected record and making a new accurate record with a new reference/key.

Reversal is allowed while collecting or ready, before any selection execution. If reversal creates a shortfall in a ready cycle, that same cycle returns to COLLECTING_CONTRIBUTIONS and its current readiness timestamps clear. Original completion/readiness events remain in audit history. Later cycles stay UPCOMING. New recordings can make the same cycle ready again.

ACTIVE group suspension is admin-only through the existing suspension endpoint. It preserves the schedule and entries and blocks all recording, reversal, and overdue commands, including admin writes. No resume flow is added. Cancellation of an activated group, including one subsequently suspended, is rejected. Core rules and memberships remain locked.

## API inventory

All endpoints use the existing authentication and ProblemDetails format with stable business error codes. No arbitrary status-write endpoint is added.

| Method and path (under `/api/v1`) | Access / behavior |
| --- | --- |
| POST `/groups/{groupId}/activate` | Owning approved organizer / platform admin |
| GET `/groups/{groupId}/cycles` | Approved/active/completed members, creator, or admin; aggregate progress only |
| GET `/groups/{groupId}/cycles/{cycleId}` | Same safe aggregate access |
| GET `/groups/{groupId}/my-contributions` | Requester's own membership history only |
| GET `/me/contributions` | Own history, filters `groupId`, `status`, `page`, `pageSize` |
| GET `/{organizer\|admin}/groups/{groupId}/cycles` | Approved owning organizer or inspecting admin |
| GET `/{organizer\|admin}/groups/{groupId}/cycles/{cycleId}/contributions` | Management view: slot, name, amounts, status, dates, immutable operation history |
| POST `/{organizer\|admin}/groups/{groupId}/cycles/{cycleId}/contributions/{contributionId}/record` | Authorized operator; `{ amount, reference, note }` plus Idempotency-Key |
| POST same prefix ending `/reverse` | Authorized operator; `{ entryId, reason }` plus Idempotency-Key |
| POST `/{organizer\|admin}/groups/{groupId}/mark-overdue` | Authorized operator; returns marked count |
| POST `/admin/groups/{groupId}/suspend` | Existing operation extended to active groups |

Normal members never receive other members' individual contribution status or management notes. Personal endpoints omit operation history and member names; management views expose only names/slots and operational data, not phone, email, address, or bank details.

## Migration, indexes, and constraints

Migration: `20260909051922_MonthlyCyclesAndContributionTracking` in Groups Infrastructure. Old migrations were preserved.

New tables in `groups`: `MonthlyCycles`, `Contributions`, `ContributionEntries`, `IdempotencyRecords`. Existing Groups receives timezone/activation/current-cycle fields; GroupAuditEvents receives nullable SubjectId.

- Unique `(GroupId, CycleNumber)` and a partial unique index for one open cycle per group.
- Unique `(CycleId, MembershipId)` obligation.
- Composite foreign keys enforce that a contribution's cycle and membership belong to the same group.
- Unique `(ContributionId, IdempotencyKey)`, unique record `(ContributionId, Reference)`, unique non-null ReversesEntryId, and unique receipt `(Scope, Key)`.
- Composite self-reference ensures a reversal points to an entry for the same contribution. Actor foreign key references Identity users.
- Check constraints enforce positive expected/entry amounts, nonnegative capped recorded amounts, cycle pool equality, member/count bounds, date order, and record/reversal shape.
- Indexes cover cycle status/due date, contribution membership/status/due date, and entry reference/history.
- Group/cycle/contribution concurrency tokens supplement group-row serialization.
- PostgreSQL triggers prohibit UPDATE/DELETE of ContributionEntries and IdempotencyRecords. Reversal adds a row; no history is deleted.

## Frontend

Added `/contributions`, `/organizer/groups/[id]/cycles/[cycleId]/contributions`, and `/admin/groups/[id]/cycles/[cycleId]/contributions`. Existing group detail pages now show activation confirmation (value, members, monthly amount, duration, date, cycle count, first method), current cycle, progress, member's own status, and full schedule. My Groups supports active groups. The header links to contribution history.

Manual record forms show remaining amount, reference, note, explicit non-payment wording, and confirmation. Individual history entries offer confirmed reversal with a required reason. Admin can inspect organizer histories but has recording buttons only for platform groups. Suspended groups show retained schedules with operations blocked. No payment button, winner, auction bid, payout action, or financial fee UI is added.

## Verification and configuration

The full suite includes deterministic clock/calendar tests, all selection configurations, 20/50-member schedules, 400/2,500 obligations, authorization/privacy, invalid pool/terms, duplicate and concurrent activation, full/partial/over recording, idempotency conflicts, concurrent full records, reversal/readiness reopening, overdue at India midnight, active suspension, append-only database protection, and injected activation rollback. Existing Prompt 1–3 tests remain included.

No new environment variables or external integration configuration is required. Existing `Database__ApplyMigrations` startup behavior applies the new Groups migration after prior migrations. For manual deployment, configure `ConnectionStrings__DefaultConnection` and run from `backend`:

```sh
dotnet ef database update --project src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure --context GroupsDbContext
```

Migration tests use disposable PostgreSQL containers. Deployment to your persistent database remains a manual operator action. PostgreSQL migration credentials need permission to create the append-only trigger function.

Known limits/deferred: fixed initial timezone, no rescheduling of immutable published rules, no member removal/replacement, no resume, no scheduled overdue job, no automatic next-cycle opening, no actual selection, auctions, payments, ledger, payout, fee settlement, debt recovery, or custody. Readiness here means **manually recorded obligations are complete**, not gateway-confirmed settlement. Automated browser interaction tests are not included; the frontend is verified by production build, lint, and TypeScript checks.
