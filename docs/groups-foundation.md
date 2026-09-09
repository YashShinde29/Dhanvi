# Groups and membership foundation

This document describes Prompt 3. [Prompt 4](cycles-and-contributions.md) extends it with activation, cycles, contribution tracking, active membership, and active suspension; the earlier limits below are historical where superseded.

One Groups aggregate supports all four combinations of creator (`PLATFORM`, `ORGANIZER`) and mechanism (`RANDOM`, `AUCTION`). Admin identity is retained for audit on platform groups; it is never an organizer. Only currently approved organizers can create, publish, approve/reject, or confirm readiness for their own groups. Admins can create/manage platform groups, inspect every group and its members, and suspend/cancel pre-active groups.

No money is collected. This milestone does not implement payments, custody, contributions, ledger entries, winner selection, bidding, payouts, activation, or monthly jobs.

## Domain rules

- `GroupRules` centralizes the initial 20–50 member limits and exact decimal currency calculation. Group value is any positive, representable `numeric(18,2)` amount whose division by capacity has no fractional paise. Backend contribution = value / capacity; duration = capacity. Client contribution/duration fields are not inputs.
- Contribution, selection, and payout days are ordered and between 1 and 28 (valid in every month). Start date must be after the current UTC date at creation, update, publication, and readiness.
- Organizer participation consumes slot 1 through an automatically approved membership. Terms are **not** automatically accepted. Participation is chosen at creation and cannot be toggled on edits in this MVP.
- Organizer-first-payout requires participation and is prohibited for platform groups. Future cycle 1 uses `ORGANIZER_RESERVED`, pays the full group value with zero discount; later cycles use `RANDOM` or `AUCTION`. Each participant receives the main payout once and must keep contributing afterward.
- Auction configuration is an immutable nested rules object with decimal minimum/maximum discount, increment, and UTC time window. It is optional at foundation stage. Random configuration reserves algorithm version, draw time, and verification method; no algorithm is implemented.

## Lifecycle and acceptance

Implemented: `DRAFT → RECRUITING → FULLY_SUBSCRIBED → READY_TO_START`. Publishing performs validation and writes a rules version atomically before exposing recruiting status; `PUBLISHED` exists in the enum but is not a separate persisted stop. Suspension and cancellation are controlled pre-active operations requiring a reason. Cancellation is also allowed from suspension. There is no resume, activation, or deletion endpoint.

Membership operations are `APPLIED → APPROVED` or `APPLIED → REJECTED`. Other requested lifecycle enum values are reserved. An organizer can be both creator and member, without a combined role. Unique group/user membership is permanent for this MVP, including rejected applications; reapplication, withdrawal, removal, and slot recycling are deferred.

Each publication stores an immutable serialized snapshot, sequential version, creator/time, and SHA-256 hash. Snapshots include rules, monetary calculations, creator type/identity, first-cycle selection method, and terms text. Rules lock permanently after the first approval (including auto membership) or acceptance. This MVP is stricter after publication: every published configuration is immutable, even before external approval. Draft name/description edits remain possible when financial rules are locked.

Application and acceptance are separate operations. An approved member reviews the disclosed rules and explicitly submits the current version ID and hash. Both are checked under the group lock; the acceptance record stores membership, version, timestamp, and hash. Readiness requires exactly capacity approved members, every current acceptance, a future start date, and a still-approved organizer.

## API inventory

All routes start with `/api/v1`. Enum JSON values use uppercase snake case. Errors use existing ProblemDetails with a stable `code` extension for group business errors. Authentication and backend role policies remain authoritative.

| Routes | Operations |
| --- | --- |
| `/groups` | GET browse with groupType, creatorType, status, min/maxGroupValue, memberLimit, organizerId, search, page/pageSize, sort (`value_asc`, `value_desc`, default newest) |
| `/groups/{id}` | GET public rules/detail plus requester's own membership; private states require creator, admin, or membership |
| `/groups/{id}/applications` | POST authenticated application |
| `/groups/{id}/accept-terms` | POST `{ groupRuleVersionId, rulesHash }` |
| `/groups/{id}/confirm-ready` | POST authorized owner/platform admin readiness |
| `/groups/{id}/organizer/contact` | GET approved/active current member contact only |
| `/my-groups` | GET memberships, pagination, filters; section = APPLICATIONS, UPCOMING, READY_TO_START, ACTIVE, COMPLETED |
| `/organizer/groups`, `/admin/groups` | GET management lists, POST draft creation |
| `/organizer/groups/{id}`, `/admin/groups/{id}` | GET management detail, PUT draft update |
| either management prefix `/{id}/publish`, `/{id}/confirm-ready` | POST controlled transition |
| either management prefix `/{id}/applications`, `/{id}/members` | GET application/member list (same history, status identifies pending applications) |
| either management prefix `/{id}/applications/{membershipId}/approve` | POST approval |
| either management prefix `/{id}/applications/{membershipId}/reject` | POST `{ reason }` |
| either management prefix `/{id}/cancel` | POST `{ reason }` |
| `/admin/groups/{id}/suspend` | POST `{ reason }` |

Public browsing includes recruiting, fully subscribed (starting soon), and ready-to-start groups; never drafts, suspended, or cancelled groups. Public organizer profile exposes name, email-verification flag, organizer status, and member-since date. Verification is labeled as email verification, not KYC. Member names/emails are restricted to management endpoints. Organizer contact exposes only name, phone, and email to approved/active members; not address, identity documents, or bank data.

## Database and concurrency

Migration: `20260909045323_GroupsAndMembershipFoundation` in the Groups infrastructure project. Tables in schema `groups`:

- `Groups`: aggregate, immutable JSONB configuration (including optional auction/random objects), searchable type/value/capacity columns, status/count/version and timestamps.
- `GroupMemberships`: application and approval state, unique slot, current accepted version, payout placeholders.
- `GroupRuleVersions`: immutable snapshot and SHA-256 hash.
- `GroupTermsAcceptances`: explicit acceptance history.
- `GroupAuditEvents`: module-owned transactional audit history. Includes all requested group event types, without participant/contact data.

Indexes cover status, type, creator type/user, value, member user/status, group histories. Unique constraints cover `(GroupId, UserId)`, `(GroupId, SlotNumber)` for non-null slots, `(GroupId, VersionNumber)`, and `(MembershipId, GroupRuleVersionId)`. Check constraints enforce capacity, positive amount, contribution/duration consistency, and slot bounds. Foreign keys restrict deletion across groups, memberships, rules, acceptances, and Identity users. Cross-module user foreign keys are explicit migration SQL contracts; Groups application code reads Identity and Organizer information through application interfaces.

Every mutation of an existing group starts a PostgreSQL transaction and obtains `SELECT … FOR UPDATE` on the group row **before** reading memberships or checking capacity. The next approval therefore sees the prior committed count, assigns the next slot, updates status, and writes audit records atomically. The final two competing approvals yield one success and one business conflict. Unique indexes and the aggregate concurrency token provide additional protection. No in-memory lock is used. New group, organizer membership, and creation audit events are saved in one EF transaction.

## Frontend

Implemented routes: `/groups`, `/groups/[id]`, `/my-groups`, `/organizer/groups`, `/organizer/groups/create`, `/organizer/groups/[id]`, `/organizer/groups/[id]/applications`, `/admin/groups`, `/admin/groups/create`, `/admin/groups/[id]`.

The existing API client, cookie authentication, protected pages, and UI styles are reused. Includes filters/pagination, empty/loading/error states, live contribution/duration/slot estimates, draft editing, publishing, organizer-first-payout disclosures, membership state, separate explicit acceptance, member/application tables, approval confirmation, rejection reasons, contact access, and readiness/moderation actions. Active/completed sections are placeholders.

## Configuration and operations

No environment variables were added. Existing `ConnectionStrings__DefaultConnection` and `Database__ApplyMigrations` apply. Startup now migrates Groups after Identity and Organizers when migration application is enabled. Run against your configured development database, or deploy the generated migration through your normal migration process. Production deployment remains an operator action.

The initial member bounds are centralized domain constants, not per-controller settings. UTC is used for calendar validation and optional auction times. No financial configuration is required.

## Verification

Domain tests exercise calculation, capacities, all mechanisms, participation, locking, publication, acceptance, readiness, and exceptional states. HTTP/PostgreSQL integration tests exercise all four creator/type combinations, role/status denials, public draft privacy, owner isolation, duplicate application, organizer contact privacy, acceptance version/hash, and simultaneous final-slot approval followed by readiness. Existing authentication/organizer tests remain in the suite.

Known foundation limits: published rules cannot be revised or a stale start date rescheduled; cancel and create a replacement when needed. No member reapplication/removal, resume, or financial lifecycle exists. Audit history is stored in the Groups schema and is not yet exposed through a consolidated admin audit browser. Management lists use bounded pagination for groups; per-group member history is bounded by the practical application volume and is currently returned as one list. Frontend verification uses production build, lint, and TypeScript checks; automated browser interaction tests are not included.

Verified on this implementation: backend build succeeded; 30 unit, 4 architecture, and 23 PostgreSQL/API integration tests passed (0 failures, 0 skips). Frontend production build, ESLint, and TypeScript checks passed.
