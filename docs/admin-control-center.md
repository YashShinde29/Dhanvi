# Member Portal vs Admin Control Center

Two frontend products on one backend, one database and one authentication authority:

```text
Dhanvi Member Portal          http://localhost:3000   apps/user-web    USER, ORGANIZER
Dhanvi Admin Control Center   http://localhost:3001   apps/admin-web   ADMIN, SUPER_ADMIN
```

The member portal answers "what do I need to do?". The control center answers "what needs my attention, where is each group, what is blocking it, who must act, what can I do?". They share `packages/*` (design system, API client, workflow engine) but have different information architecture. No app imports another app's `src` (enforced by `tests/app-separation.test.mjs`), and the admin bundle never reaches member participation screens (checkout, bank account form, member dashboard) while the member bundle never reaches admin screens (`tests/role-separation.test.mjs`).

## Navigation

| Member portal (before → after) | Admin Control Center (before → after) |
| --- | --- |
| Dashboard, Browse groups, My groups, Contributions, Payments, Payouts, Financial history, Profile, Become an organizer + Organizer (dashboard, Manage groups, Create group, Applications) | Dashboard, Organizers, Groups, Payments, Payouts, Ledger |
| **Home, My groups, Browse groups, Contributions, Payments, Payouts, Profile** (+ Become an organizer until approved); Organizer: **Organizer, My managed groups, Applications**. "Create group" lives once, on My managed groups. Financial history is linked from Payments. | **Dashboard, Groups, Organizers, Payments, Payouts, Reconciliation, Ledger**. Users, Audit and Settings are not listed: the backend has no read endpoints for them. |

## Backend read models (new `Admin` module)

Read-only, `AdminOnly`, composed from per-module readers that each module implements in its own Infrastructure (Groups, Payments, Payouts, Organizers). No business rule is re-implemented; the readers project persisted state.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/admin/operations/overview` | Dashboard: group counts by lifecycle, attention buckets (count + oldest since) for activations, confirmations, applications, cycles ready for selection (gateway-collected only for payout preparation), overdue collection, auctions, payment and payout exceptions, organizer applications, active members |
| `GET /api/v1/admin/groups/operations?status&creatorType&groupType&cycleStatus&organizerId&search&page&pageSize&sort` | Group management table: one row per group with current-cycle snapshot (settled/outstanding, selection, auction, winner), payment and payout counts, terms-pending count, last activity. One page = a fixed number of set-based queries; no per-row calls. |
| `GET /api/v1/admin/groups/{id}/operations-summary` | Group page: row + every cycle snapshot + outstanding contributions of the current cycle + payouts + payment exceptions + derived issues (suspended, reconciliation mismatches, failed payouts, missing beneficiary, auction without bids, overdue contributions) + merged group/payout activity |

`PayoutView` gained `beneficiaryAvailable`: the backend keeps unapproved payouts in `PENDING_BENEFICIARY` until an admin approves; the read model states whether the recipient's latest account is usable so the UI can show "awaiting approval" versus "waiting on member" without guessing. Query-string enums bind as PascalCase (`enumParam` in the API client).

Integration tests: `tests/Dhanvi.IntegrationTests/Api/AdminOperationsEndpointTests.cs` (authorization boundary, aggregation and cycle-state filter, summary contents, overview counts).

## Next-action engine

`packages/features/src/workflow/group-control.ts` — `deriveGroupControl()` turns backend state (group, current cycle, auction capability flags, payout counts, payment issues) into one `GroupControlState`: stage, status, headline, blocked-by, waiting-on, who acts next, next step, **one primary action**, secondary links, overflow (rare/destructive). Authority mirrors the backend: admins operate PLATFORM groups end to end and may only suspend/cancel ORGANIZER groups; organizers operate their own groups. `GroupControlPanel` (`groups/group-control-panel.tsx`) is the only place that issues lifecycle commands (publish, confirm ready, activate, selection, open/close auction, prepare payouts, mark overdue, suspend, cancel) — guarded by `tests/role-separation.test.mjs`.

`workflow/admin-operations.ts` — `groupHealth()` (Healthy / Attention required / Blocked / Waiting on others / Completed / Closed, with the reason) and the dashboard `adminAttention()` / `adminWaiting()` lists. Health is presentation only; lifecycle and cycle states are untouched.

## Admin Control Center pages

- **Dashboard** — "Requires your attention" (severity, age, one CTA each, deep-linking to filtered module pages), "Moving without you", platform health stats, module navigation. One API call.
- **Groups** — management table (creator, type, value, members, lifecycle, cycle, collection, selection, payouts, health, last activity) with Lifecycle / Creator / Type / Cycle state / Health / search filters mirrored in the URL. One action per row: View. "Create platform group" lives here once.
- **Create platform group** — Basics → Group type → Financial structure → Schedule → Rules (collection mode: manual tracking or Razorpay test; a real backend field, platform groups only) → Review & publish (Creator: Dhanvi platform, start rule) with **Publish group** (create + publish) or Save as draft.
- **Group page** — facts strip, Group Control (current situation, blockers, who acts, one primary action, ••• for ledger/suspend/cancel), Issues & blockers (only when present), tabs Overview (cycle stage facts, outstanding members, recent activity, tracking timeline: Created → Published → Recruiting → Filled → Ready → Activated → Cycle n stages → Completed), Members (operational: slot, membership, rules, this-cycle contribution, selection eligibility, payout), Applications (only while relevant; Review → drawer → Approve/Reject), Cycles, Contributions (Expected / Manual recorded / Gateway settled / Payment status / Due / Status), Payments (Razorpay groups: exceptions only), Selection or Auction (display-only; command in Group Control), Payouts (stage + one contextual link), Ledger, Activity (technical events collapsed), Rules. Organizer-created groups are monitor-only with a callout.
- **Cycle control** — COLLECTING: no admin action unless manual recording or reconciliation; READY_FOR_SELECTION: Start selection / Record organizer payout; auction: Open (only inside the server-enforced window) then Close; SELECTION_COMPLETED: Prepare payouts (gateway-funded groups) or an explanation that manual-tracking groups cannot be prepared (backend `FUNDED_POOL_REQUIRED`); then Approve → Execute → Reconcile as separate stages.
- **Payments** — exception-first list (priority strip filters), detail with one action only when needed (Reconcile / Check provider status); captured + matched shows no button.
- **Payouts** — priority strip from the operations read model, collapsible filters, detail with a stage panel, readiness checklist and exactly one command per stage (Approve → Execute → Retry / Reconcile); ledger journals in the overflow.
- **Reconciliation** — payments and payouts whose provider data mismatches, each with one Review action.
- **Ledger** — journals, trial balance, accounts, per-group ledger (accounting presentation, unchanged).

## Member portal pages

- **Home** — Your next actions (one button each), Waiting for, My groups. No statistics.
- **Group page** — facts strip, **Your status** (Apply / Review & accept rules / Pay now via Checkout / all caught up + waiting-for / selection result / payout status / group paused), tabs Overview, My contribution, Schedule, Selection or Auction, Payout, Rules. Operational states are translated ("Your payout is delayed. Dhanvi is reviewing the transfer.").
- **Organizer group page** — Where your group stands (Group Control with the organizer's own valid action), Applications, Members, Contributions (record), Cycle, Selection or Auction, Payout status (monitoring only), Rules.

## Hand-offs

Every command toast names the next actor ("Membership approved ✓ — Next: Yash Shinde must accept the group rules"), every waiting state names who it waits on, and every dashboard item carries its responsible role and age.

## Known limitations

- Manual-tracking groups cannot reach payouts inside the platform (ledger pool is never funded); the control panel says so instead of offering a button.
- The backend has no endpoints for user management, a platform audit browser or settings, so those modules are absent.
- Payments have no per-group filter in the API; the group Payments tab shows exceptions from the summary and links to the module page.
- The health filter on the groups table applies to the loaded page (health is derived client-side); all other filters are server-side.

## Auction experience (flagship screen)

Dedicated route in every app: member `/groups/{id}/cycles/{cycleId}/auction` (member experience), organizer `/organizer/groups/…/auction` (controls, plus own participation when the organizer saves in the group), admin `/groups/…/auction` (operations). Group pages and the member home only show a compact cycle card with one link into it.

- `packages/features/src/auctions/auction-experience.tsx` — one page for SCHEDULED → LIVE → CLOSING → COMPLETED; hero = current highest discount → projected winner payout → group value, with the visible formula; server-clock countdown; recent bid movement (member positions only); your bids; details; how it works.
- `bid-panel.tsx` — personal status (leading / outbid / not bid / ineligible / closed), Quick bid (minimum next, +1, +2 increments, capped), custom discount with live payout preview and validation, Review → Confirm → Place, stale-bid explanation (`BID_INCREMENT_NOT_MET`), mobile sticky Review bar.
- `auction-model.ts` — pure derivations (`tests/auction-model.test.mjs`); `use-live-auction.ts` — 3 s polling while OPEN, 20 s otherwise, stopped when completed, paused when hidden, non-overlapping, immediate refresh after own bid.
- `auction-operations.tsx` — admin/organizer control: status, window, counts, leader, one action per state, bid monitoring table, audit history.
- Backend: `AuctionDetails` gained `groupValue`, `groupName`, `durationMonths`, `recentBids` (amount, time, member position, isMine, isCurrentHighest) and `currentLeaderSlot`; no rule changed. Covered by `AuctionExperienceTests`.
