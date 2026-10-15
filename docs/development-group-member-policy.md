# Group member policy

Groups have between `minimum` and 50 members. The minimum depends on the environment:

| Environment | Minimum | Maximum | Where it is decided |
| --- | --- | --- | --- |
| `NODE_ENV=development` or `test` | 2 (override with `GROUP_POLICY_MIN_MEMBERS`, never below 2) | 50 | `backend/src/config/groups.ts` |
| `NODE_ENV=production` (and anything else) | 2 | 50 | Startup fails if a different range is configured |
| Web apps | `NEXT_PUBLIC_MIN_GROUP_MEMBERS` (development/test builds only); production builds always use 2 | 50 | `frontend/packages/config/src/env.ts` |

The backend policy is the authority. It is applied when a group is created, updated, published and activated, and in every
auction calculation (`backend/src/features/group/group.domain.ts`, `backend/src/features/auction/auction.domain.ts`). The web
apps use the same values only for form defaults and early validation messages.

## Database guard

The database already accepts 2–50 members in every environment; lowering the production minimum needs no migration:

| Table / check | Range |
| --- | --- |
| `groups."Groups"` / `CK_Group_Rules` | `(Rules->>'MemberLimit')::int BETWEEN 2 AND 50` |
| `groups."MonthlyCycles"` / `CK_Cycle_Expected` | `ExpectedMemberCount BETWEEN 2 AND 50` |
| `groups."Auctions"` / `CK_Auction_Rules` | `MemberLimit BETWEEN 2 AND 50` |
| `groups."AuctionResults"` / `CK_AuctionResult_Money` | `MemberLimit BETWEEN 2 AND 50` |

## Deploying the two-member minimum

Deploy the updated backend and rebuild both web apps. On Render, leave `GROUP_POLICY_MIN_MEMBERS` unset or set it to `2`;
an old explicit value of `20` must be removed or changed before restarting the updated backend. Set
`NEXT_PUBLIC_MIN_GROUP_MEMBERS=2` in both Vercel projects for consistent build settings. Existing groups retain their chosen
member limit; select 2 when creating a new group to use a two-member group.

## Tests

- `backend/test/integration/groups-cycles.test.ts` creates and activates groups of 2–4 members under the test policy and
  checks `INVALID_MEMBER_LIMIT` below the minimum.
- `frontend/tests/group-policy.test.mjs` covers the web apps' development, test and production values.
- `backend/test/unit/group-policy.test.ts` covers production defaults, explicit configuration and invalid minimums.
