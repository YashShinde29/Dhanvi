# Random and organizer-reserved selection (Prompt 5)

Prompt 5 selects a **payout recipient/right**, not a payment. The cycle stops at `SELECTION_COMPLETED`. No auction bidding, auction execution, payout, payment gateway, ledger, fee, or next-cycle processing is implemented.

## Module ownership

Four new projects activate RandomDraws: Domain (versioned algorithm, canonical snapshot, immutable result, pure verification), Application (selection policy/use case/contracts), Infrastructure (cryptographic entropy and DI), and Api (selection endpoints). Groups Infrastructure implements a persistence adapter against its existing transaction/DbContext boundary. The random algorithm is not embedded in that adapter. Groups and Cycles keep their state behavior; membership keeps payout-right eligibility. No distributed messaging or service is added.

## Transaction, authorization, and eligibility

Selection executes under the existing PostgreSQL group-row `FOR UPDATE` lock, serializing with contribution recording, reversal, activation, and suspension. The application revalidates an ACTIVE group, the owning approved organizer or platform admin, the current READY_FOR_SELECTION cycle, no prior result, and every contribution obligation and pool total. It builds the eligible snapshot, derives the result, marks the winner's payout right, advances the cycle, and writes audits in one transaction. The persistence adapter commits only after all writes succeed. An injected snapshot-insert failure is covered by integration tests and rolls back the result, membership marker, cycle state, and audits.

Eligible RANDOM memberships belong to the group, are ACTIVE, have a valid unique occupied slot, correspond to an active user, have not been selected for payout before, and have a fully recorded current-cycle obligation. Pending/rejected/withdrawn/removed memberships, inactive users, and previous winners are excluded. The snapshot contains membership IDs and slots, with no name/contact data. Zero candidates fails with `NO_ELIGIBLE_MEMBERS` before requesting entropy. One candidate is valid and receives a normal verifiable proof.

An organizer reservation requires an organizer-created group, the published participation/first-payout rules, cycle 1, an ACTIVE eligible organizer membership, and a still-approved organizer account. It selects that membership without entropy or an auction discount, using `ORGANIZER_RESERVED_V1`. Its snapshot has one candidate. A normal AUCTION cycle is explicitly rejected with `AUCTION_SELECTION_NOT_SUPPORTED_HERE`; an AUCTION group's configured organizer-reserved cycle 1 remains supported.

There is no admin override for someone else's organizer-group execution. Admin can inspect/verify all results and execute platform-group selections. Normal members can view results/verification but cannot trigger selection. Suspended/cancelled groups cannot execute. Result reads remain available to authorized members after suspension.

## Payout-right semantics and lifecycle

The migration renames `GroupMemberships.HasReceivedPayout` to `HasBeenSelectedForPayout`, preserving data. A read-only domain compatibility alias remains for earlier callers/tests; it is ignored by EF. New DTOs/UI use `hasBeenSelectedForPayout` and `payoutCycleNumber`. Selection sets the flag and cycle number without changing membership out of ACTIVE: selected members still owe all later contributions.

`MonthlyCycle.CompleteSelection` controls `READY_FOR_SELECTION → SELECTION_COMPLETED` and records SelectionResultId and SelectionCompletedAt. It does not advance payout/completion states or open another cycle. Contribution reversals are rejected after selection. A later payout module can reference the immutable selection ID, cycle ID, and winner membership ID.

## DHANVI_RANDOM_V1: exact immutable specification

**Never change V1's bytes, hashes, mapping, or verification semantics after deployment.** A different algorithm must use a new version and retain historical V1 verification.

All strings below use UTF-8 without BOM. Separators are a single LF byte (`0a`), including exactly one trailing LF. UUIDs use lowercase, hyphenated 36-character `D` format. Decimal integers use invariant ASCII digits with no padding/sign/group separators. Hashes and revealed seeds use lowercase hexadecimal. No timestamps or user profile data are included in deterministic hashes.

1. Validate unique nonempty membership UUIDs and unique integer slots, each within 1–50. Sort ascending by slot. The zero-based position is `Ordinal`/selected index. Group/cycle UUIDs must be nonempty and cycle number must be 1–50.
2. Canonical eligible payload is the following lines, followed by LF:

   ```text
   DHANVI_RANDOM_V1
   <group UUID>
   <cycle UUID>
   <cycle number>
   <membership UUID>:<slot>
   <membership UUID>:<slot>
   ...
   ```

   `EligibleSetHash = lowercase_hex(SHA256(UTF8(payload)))`.
3. Production generates exactly 32 bytes once per execution attempt with `RandomNumberGenerator.Fill`, through `ISecureRandomSource`. Automated selection tests inject deterministic seeds; production registers `CryptographicRandomSource`.
4. `SeedCommitment = lowercase_hex(SHA256(raw seed bytes))`. `SeedReveal = lowercase_hex(raw seed bytes)`.
5. Starting with unsigned counter 0, construct this UTF-8 context, including the final LF:

   ```text
   DHANVI_RANDOM_V1
   <group UUID>
   <cycle UUID>
   <cycle number>
   <EligibleSetHash>
   <counter in invariant decimal>
   ```

   Hash the **raw 32 seed bytes concatenated directly with these context bytes**. Interpret the digest's first 8 bytes as an unsigned 64-bit **big-endian** integer `x`.
6. For candidate count `n`, let `threshold = 2^64 mod n`. Reject `x < threshold`, increment the counter, and derive another digest. Otherwise select `index = x mod n`. The accepted range has a size divisible by `n`; rejection avoids modulo bias. The C# implementation calculates the threshold as `unchecked(0UL - (ulong)n) % (ulong)n`. For `n = 1`, threshold/index are both zero. Counter exhaustion fails rather than wrapping.
7. The selected index identifies the winner in the canonical snapshot. Compute ResultHash from these UTF-8 lines, including final LF:

   ```text
   DHANVI_RANDOM_RESULT_V1
   DHANVI_RANDOM_V1
   <group UUID>
   <cycle UUID>
   <cycle number>
   <EligibleSetHash>
   <SeedCommitment>
   <SeedReveal>
   <selected index>
   <winner membership UUID>
   ```

   `ResultHash = lowercase_hex(SHA256(UTF8(result payload)))`.

The independent golden vector in [examples/random-v1-test-vector.json](examples/random-v1-test-vector.json) is asserted in the .NET unit suite. Its selected index is 1 and ResultHash is `f98c26f97cbbe567f1fc758bf7b6d00f47f0bb2c139ba61b6b1f5108e2ecd885`.

The reserved result hash uses LF-terminated UTF-8 lines: `ORGANIZER_RESERVED_V1`, group UUID, cycle UUID, `1`, organizer membership UUID, organizer slot. It carries no random seed/proof.

## Verification and commit/reveal limits

`RandomDrawVerifier` is pure: it checks the algorithm version, exact canonical ordering, eligible-set hash, decoded seed/commitment, derived index/winner, and result hash. Tampered seed, membership set/order, winner, hash, malformed seed, or unsupported version fails safely. The backend verification endpoint is mandatory and returns both verification status and the proof. The UI's Recalculate Verification button calls that verifier; there is no separate browser crypto implementation.

For independent verification with Python 3 and no packages/network:

```sh
python3 tools/verify-random-draw.py docs/examples/random-v1-test-vector.json
python3 tools/verify-random-draw.py downloaded-verification.json
```

The tool accepts the whole endpoint response or its `proof` object. The UI exposes the full JSON payload for copying/exporting.

The seed and commitment are persisted atomically **with the completed draw**; the preview endpoint does not generate or reveal a seed. The commitment proves consistency with the revealed stored seed. **It does not establish that the operator publicly committed to the seed before drawing or that the operator could not have searched other seeds.** This MVP relies on the deployed execution code and database controls. Stronger future designs can use published precommitment, an external randomness beacon, multiparty entropy, or HSM/KMS support; these are not implemented. Failed transactions leave no completed result and a later execution attempt can acquire fresh entropy.

## Idempotency, constraints, and immutability

Idempotency is by cycle, not a required request header. If the cycle has a consistent completed result, another POST returns that same result without generating entropy or writing duplicate events. Group-row serialization protects different browser tabs, processes, and servers; database constraints provide a second boundary.

Migration: `20260909100752_RandomAndReservedSelectionFoundation` in Groups Infrastructure. Tables in the `groups` schema:

- `SelectionResults`: authoritative immutable completed result, selected membership/user/slot, algorithm/source, hashes, seed reveal, selected index, actor/time.
- `SelectionEligibleMembers`: relational immutable snapshot of selection ID, group ID, membership ID, slot, and ordinal.

Uniqueness: CycleId; `(GroupId, CycleNumber)`; `(GroupId, WinnerMembershipId)`; snapshot `(SelectionResultId, MembershipId)`, `(SelectionResultId, Ordinal)`, and `(SelectionResultId, SlotNumber)`. Composite foreign keys enforce matching cycle/group and winner membership/user/group. Snapshot foreign keys enforce the same group and a real membership. The actor references Identity users. Cycle holds a result foreign key. Checks enforce ranges and supported random/reserved field combinations. PostgreSQL triggers prohibit UPDATE/DELETE on both result and snapshot tables. There is no result-edit, replacement, rerun, or correction API.

Audit adds safe CycleId, SelectionResultId, WinnerMembershipId, and AlgorithmVersion fields. Events: ORGANIZER_RESERVED_SELECTION_EXECUTED, RANDOM_DRAW_EXECUTED, SELECTION_RESULT_CREATED, MEMBER_SELECTED_FOR_PAYOUT, CYCLE_SELECTION_COMPLETED, and RANDOM_DRAW_VERIFIED (successful explicit verification). Seeds/proofs remain in result storage and are never copied into generic audit events.

## API and frontend

All routes require authentication and begin with `/api/v1/groups/{groupId}/cycles/{cycleId}/selection`:

| Method / suffix | Behavior |
| --- | --- |
| POST root | Execute or return existing result; backend derives winner, eligible set, seed, and time |
| GET root | Safe completed result: abbreviated winner display name, membership/slot, method, eligible count, execution time, algorithm |
| GET `/preview` | Authorized operator's ready-state candidate count/algorithm; no entropy or personal candidate list |
| GET `/verify` | Member/organizer/admin proof and deterministic verification status; reserved selection returns RANDOM_VERIFICATION_NOT_APPLICABLE |

The request never accepts winner, eligible list, seed, or execution time. Display names are current abbreviated profile names; immutable identity is the membership/user ID stored in the result. Public unauthenticated users cannot retrieve winner identity or verification data.

Existing member/organizer/admin group cycle panels show readiness, execution confirmation, selected recipient, method/time, and a verification link. The reserved confirmation explains the published first-cycle right and the absence of payout. RANDOM confirmation shows group, cycle, candidate count, algorithm, date, and finality. Normal members see waiting text, not Execute. AUCTION shows that execution is unavailable. `/groups/[id]/cycles/[cycleId]/selection/verify` displays hashes, revealed seed, canonical slots/IDs, index, and backend verification status. Membership view labels the selected payout right explicitly, never “paid”.

## Configuration, verification, and deferred work

No new environment variables or external service configuration. Existing migration application startup applies the new migration after Prompts 1–4. To apply manually from `backend`, configure your normal connection string and run:

```sh
dotnet ef database update --project src/Modules/Groups/Dhanvi.Modules.Groups.Infrastructure --context GroupsDbContext
```

The suite includes deterministic golden hashes, rejection boundaries, alternate seeds, singleton/empty/invalid sets, tamper detection, eligibility exclusion, reserved rules, production source shape, PostgreSQL atomic selection, concurrent/retried execution, immutable snapshots/results, database uniqueness, rollback, safe member visibility, verification audit, and reversal blocking after selection. Prompt 1–4 tests remain included.

Deferred: auction execution, payouts, payments, ledger accounting, platform fees, financial reconciliation, stronger external/precommitted randomness, correction workflows, and automatic next-cycle opening. No real payout occurs in Prompt 5. Automated browser interaction tests are not included; frontend validation uses build, lint, and TypeScript checks.

Final verification: Release backend build passed with 0 warnings/errors; 88 unit tests, 7 architecture tests, and 56 PostgreSQL/API integration tests passed with 0 failures/skips. Frontend production build, ESLint, and standalone TypeScript checks passed. The independent Python verifier reproduced the golden result and rejected a changed seed. The migration was exercised on disposable PostgreSQL test databases; persistent deployment was not performed.
