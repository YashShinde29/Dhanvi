# Auction engine — DHANVI_AUCTION_V1

Prompt 6 continues the implementation already committed in `f0175da`. It records payout rights and calculated benefit allocations. It does not move money.

## Checkout inspection and scope

Inspection began on clean `main`, at `cfe018e`, up to date with its local `origin/main` reference. The previous ten-commit inspection showed `f0175da Prompt 6 — Auction Engine` and the Prompt 4/foundation history. No uncommitted work was overwritten.

Already present: auction domain entities, decimal validation/calculator, service and endpoint implementations, group-row locking, EF mappings, selection integration, and V1 audit actions. Prompt 5 random/reserved selection and its migration/tests were also present.

Absent in this Windows checkout: the auction database migration, dedicated auction unit/integration/architecture coverage, auction screens/service/types, and auction documentation. The reported `OwnBids` array-return change was absent and produced CA1859. The relational EF package reference was also missing and prevented compilation. Whether absent files existed only on the Mac cannot be determined from this checkout.

Completed here: those missing pieces, explicit group/cycle/auction row locks, stable bid receipt replays and a compact 100-character scope compatible with the Prompt 4 receipt column, UTC configuration interpretation, database history guards and allocation checks, and Windows verification. Existing Prompt 1–5 migrations were preserved.

## Calculation and version

For group value G, winning discount D, and member limit N:

- Winner payout right = G − D.
- Gross member share = D / N.
- Proposed platform service fee = gross member share (`WINNER_MEMBER_SHARE`).
- Member benefit pool = D − proposed platform fee.
- Each of the N − 1 other original member positions receives one gross member share, including prior payout recipients.
- Member benefit pool + platform fee = D. The fee is contained in the discount, never added to it.

Example: G = ₹5,00,000, D = ₹1,50,000, N = 20. Winner payout right = ₹3,50,000. Gross share and proposed fee = ₹7,500. The other 19 positions have ₹7,500 calculated benefits each, totaling ₹1,42,500.

The backend uses `decimal`. Validation checks `D * 100 % N == 0` and rejects amounts beyond two decimal places. No rounded allocation is persisted. Frontend bid input and preview subtraction use integer paise, and submission preserves the entered decimal JSON token.

Auction and selection results persist `DHANVI_AUCTION_V1`. Its financial behavior must remain unchanged; future policies require a new version and migration.

## Lifecycle and eligibility

A ready auction cycle exposes its scheduled window. Only its owning approved organizer, or an administrator for a platform-created group, can open or close it. Opening persists the scheduled auction and transitions it to `OPEN` within the configured window. One auction is allowed per cycle.

Bidding requires an active group and user, the current cycle in `READY_FOR_SELECTION`, `AUCTION` selection method, an open auction within its window, an active group membership, no previous main payout selection, and a fully recorded current contribution. Group suspension blocks mutations. All required contributions are rechecked at opening, bidding, and closing.

Cycle 1 in an organizer-first group remains `ORGANIZER_RESERVED`; auction endpoints reject it. Cycle 2 and later use auction selection once explicitly made current and ready by a future cycle workflow. Tests prepare this state explicitly; this milestone does not open the next cycle.

Bids are positive discounts, at least the configured minimum, at most the maximum, and below group value. After the first bid, a discount must be at least current highest + increment. A member can submit further higher bids. Previous bids cannot be cancelled, updated, or deleted.

Close selects highest discount, then earliest server-generated sequence. Client timestamps and randomness are not used. The positive increment normally prevents ties through the public API, but the V1 ordering is deterministic for an authoritative tied history.

A zero-bid close persists `CLOSED_NO_BIDS`, audit events, and no result or allocations. The cycle remains unresolved in `READY_FOR_SELECTION`. There is no random fallback, full-payout assignment, or reopen endpoint.

## Persistence, locking and atomicity

Migration: `20260909154641_AuctionEngine`, in the existing Groups context/schema. It adds:

| Entity | PostgreSQL table |
| --- | --- |
| Auction | `groups."Auctions"` |
| AuctionBid | `groups."AuctionBids"` |
| AuctionResult | `groups."AuctionResults"` |
| AuctionBenefitAllocation | `groups."AuctionBenefitAllocations"` |

The migration extends the existing `SelectionResults` method constraint for auction results; it does not duplicate the Prompt 5 selection tables.

Each mutation runs in a PostgreSQL `READ COMMITTED` transaction and locks the group, cycle, and existing auction with `SELECT … FOR UPDATE`, in that order. The group-row lock is the same one used by membership, contributions, and selection operations. Reads use `REPEATABLE READ`.

Sequence assignment increments `Auction.LastBidSequence` under those locks. Unique indexes enforce (auction, sequence), (auction, membership, idempotency key), one auction/result per cycle, and one selection per member per group. An EF concurrency token is an additional guard.

If the bid commits first, close reads and includes it. If close commits first, a new bid fails `AUCTION_CLOSED`. Integration tests queue both requests on a held PostgreSQL group lock and verify both lock orders.

Close calculates the result and all allocations, creates an auction `SelectionResult` with its eligible snapshot, marks the winner selected for main payout, completes the cycle at `SELECTION_COMPLETED`, adds audit events, and commits all changes together. A database failure rolls back all of them. Repeated/concurrent closes return the stored result without duplicate writes.

PostgreSQL triggers reject updates/deletes to bids, results, and allocations; reject reopening terminal auctions; and prevent inserting a bid into a closed auction. Deferred constraint triggers verify that the full set of allocations exists at commit, covers original non-winning contribution positions, has exactly one proposed fee, and conserves the discount.

## Idempotency and privacy

`Idempotency-Key` is required, nonblank, and at most 128 characters. The existing Prompt 4 `IdempotencyRecords` infrastructure stores a SHA-256 canonical decimal payload fingerprint and the bid ID, scoped to group + cycle + actor.

Same key and same amount returns the original submission response, even after an outbid or finalization. Reusing it for a different amount returns `IDEMPOTENCY_KEY_REUSED`. GET history independently reports the current highest/winning flags. Browser retries keep their key while the amount is unchanged.

Members see their own bid history and personal allocation. Owning organizers and administrators can inspect operational bid/audit information. Result winner names follow the existing selection display-name policy.

## Timezone interpretation

Prompt 3 published `AuctionStartTime` and `AuctionEndTime` as **UTC clock-time configuration**, as documented in `groups-foundation.md` and labelled in the existing group form. These are `TimeOnly` values, not stored instants and not business-local clock times.

The auction service combines the cycle's `SelectionDate` calendar label with each configured UTC time, producing UTC `DateTimeOffset` instants. It does not apply an Asia/Kolkata conversion to those already-UTC clock values. For example, 10:00–11:00 UTC on 2 January displays as 15:30–16:30 on 2 January in Asia/Kolkata. A late UTC window can display on the next local calendar day; the UI displays the full local date and time.

Prompt 4 contribution/due dates remain business calendar dates in `GroupTimeZone`; actual event timestamps remain UTC. Group timezone remains Asia/Kolkata by default. Tests explicitly reject opening at 04:30 UTC for a 10:00 UTC configuration and verify the 15:30 IST display conversion.

## API

All paths have the `/api/v1` prefix and require authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/groups/{groupId}/cycles/{cycleId}/auction` | State, window, capabilities, own bids, authorized history/result |
| POST | `/groups/{groupId}/cycles/{cycleId}/auction/bids` | Submit `{ "discountAmount": 150000 }` with `Idempotency-Key` |
| GET | `/groups/{groupId}/cycles/{cycleId}/auction/my-bids` | Own bid history |
| GET | `/groups/{groupId}/cycles/{cycleId}/auction/result` | Final calculation |
| POST | `/organizer/groups/{groupId}/cycles/{cycleId}/auction/open` | Open owned organizer auction |
| POST | `/organizer/groups/{groupId}/cycles/{cycleId}/auction/close` | Close owned organizer auction |
| POST | `/admin/groups/{groupId}/cycles/{cycleId}/auction/open` | Open platform auction |
| POST | `/admin/groups/{groupId}/cycles/{cycleId}/auction/close` | Close platform auction |

## Frontend

`AuctionPanel` replaces the unavailable-auction placeholder in the current cycle panel. `AuctionPage` exposes member, organizer, and admin routes at:

- `/groups/[id]/cycles/[cycleId]/auction`
- `/organizer/groups/[id]/cycles/[cycleId]/auction`
- `/admin/groups/[id]/cycles/[cycleId]/auction`

Cycle schedule rows link to auction history. The panel refreshes every five seconds and supports manual refresh. It displays all configured limits, opening/closing times in GroupTimeZone, highest/next discount, own history, exact payout preview, management controls, and audit history when authorized.

Bid confirmation: “You are bidding a discount of ₹X. If this becomes the winning bid, your payout right will be ₹Y before actual payout processing.”

Results show Auction Completed, Winning Member, Group Value, Winning Discount, Winner Payout Right, Benefit Per Other Member, Total Member Benefit, Proposed Platform Service Fee, and Pending Payout. They explicitly state: “No actual payout has been processed yet.”

## Audit events

`AUCTION_CREATED`, `AUCTION_OPENED`, `AUCTION_BID_SUBMITTED`, `AUCTION_CLOSED`, `AUCTION_CLOSED_NO_BIDS`, `AUCTION_WINNER_SELECTED`, `AUCTION_CALCULATION_FINALIZED`, `AUCTION_MEMBER_BENEFITS_CALCULATED`, `AUCTION_PLATFORM_FEE_CALCULATED`, `CYCLE_AUCTION_SELECTION_COMPLETED`, and `MEMBER_SELECTED_FOR_PAYOUT`.

## Windows verification

See `prompt-6-windows-verification.md` for the final counts and results from this checkout.

The repository targets the pinned .NET 10.0.302 SDK. It was installed into the user's `.dotnet` directory because this machine's system SDK was .NET 9. Set the current shell PATH to that SDK before running the existing backend commands.

```powershell
$env:PATH = "$env:USERPROFILE\.dotnet;$env:PATH"
dotnet restore backend/Dhanvi.sln
dotnet build backend/Dhanvi.sln -c Release
dotnet test backend/Dhanvi.sln -c Release --no-build

Set-Location frontend
npm ci
npm run build
npm run lint
npm run typecheck
```

Integration tests default to Testcontainers PostgreSQL 18. When Docker is unavailable, set `DHANVI_TEST_POSTGRES` to a **test-server** connection with permission to create databases. Each fixture creates a fresh randomly named database, applies the real migrations, and drops only that database when finished. An isolated PostgreSQL 18.3 cluster on loopback was used for this Windows run; existing PostgreSQL services/databases were not changed.

The original frontend lockfile failed `npm ci` because optional transitive emnapi entries were inconsistent. `npm install` repaired it without changing the pinned Next/React/TypeScript dependencies.

## Limitations and deferred work

Opening and closing are authorized manual actions. Bids stop at the configured end even if close has not yet been invoked. Closed-no-bid auctions and invalidated highest bidders require future authorized intervention; the MVP provides no reopen or fallback workflow. Existing activated auction groups without published auction rules cannot be opened by inventing configuration.

There are no real payments, payment gateway/Razorpay/UPI/bank transfers, payouts, benefit settlement, fee collection, ledger, automatic next-cycle opening, notifications, escrow, custody, tax, or GST behavior. All persisted values are payout rights and proposed calculated allocations.
