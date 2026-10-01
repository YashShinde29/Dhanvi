import type { Database } from "../../infra/database/db.js";
import type { Actor, Clock } from "../../types/common.types.js";
import { newId } from "../../utils/crypto.js";
import { snakeUpper } from "../../utils/enums.js";
import { NotFoundError, requireRule } from "../../utils/errors.js";
import { writeGroupAudit } from "../audit/audit.service.js";
import { completeSelection } from "../cycle/cycle.domain.js";
import { cycleRepository } from "../cycle/cycle.repository.js";
import { selectForPayout } from "../group/group.domain.js";
import { groupRepository } from "../group/group.repository.js";
import type { LedgerPostingService } from "../ledger/ledger.posting.js";
import { canonicalMembers, draw, RANDOM_ALGORITHM_VERSION, RANDOM_SOURCE_TYPE, type RandomDrawProof, reservedResultHash, verifyDraw } from "./random-draw.algorithm.js";
import { insertSelectionResult, loadSelectionContext, type SelectionContext, type SelectionResult } from "./selection.context.js";
import { authorizeOperator, authorizeReader, eligible, requireReady, reservedOrganizer } from "./selection.policy.js";

/** Source of 32-byte seeds; tests may inject a deterministic one. */
export type SeedSource = () => Buffer;

/**
 * Port of SelectionService (random and organizer-reserved). Execution is idempotent: the cycle row and the unique
 * SelectionResults(CycleId) index guarantee exactly one immutable result; a repeated call returns it.
 */
export class RandomDrawService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly ledger: LedgerPostingService, private readonly seed: SeedSource) {}

  async execute(groupId: string, cycleId: string, actor: Actor) {
    return this.db.transaction(async (tx) => {
      const s = await loadSelectionContext(tx, groupId, cycleId, actor.userId, true);
      authorizeOperator(s, actor);
      if (s.existingResult) {
        requireRule(s.cycle.status === "SelectionCompleted" && s.cycle.selectionResultId === s.existingResult.id, "SELECTION_ALREADY_COMPLETED", "The cycle's persisted selection references are inconsistent.");
        return map(s, s.existingResult);
      }
      requireReady(s);
      const now = this.clock.now();
      let result: SelectionResult;
      let winner;
      if (s.cycle.selectionMethod === "OrganizerReserved") {
        winner = reservedOrganizer(s);
        const member = { membershipId: winner.membership.id, slotNumber: winner.membership.slotNumber as number };
        result = { id: newId(), groupId, cycleId, cycleNumber: s.cycle.cycleNumber, selectionMethod: "OrganizerReserved", winnerMembershipId: member.membershipId,
          winnerUserId: winner.membership.userId, winnerSlotNumber: member.slotNumber, eligibleMemberCount: 1, executedAt: now, executedByUserId: actor.userId,
          algorithmVersion: "ORGANIZER_RESERVED_V1", randomSourceType: null, seedCommitment: null, seedReveal: null, eligibleSetHash: null,
          resultHash: reservedResultHash(groupId, cycleId, member), selectedIndex: null, eligibleMembers: [{ ...member, ordinal: 0 }] };
        requireRule(s.cycle.cycleNumber === 1, "INVALID_ORGANIZER_RESERVED_CYCLE", "Organizer reservation applies only to cycle 1.");
      } else {
        const pool = eligible(s);
        requireRule(pool.length > 0, "NO_ELIGIBLE_MEMBERS", "No eligible membership remains for this draw.");
        // Canonicalize and validate before acquiring entropy. Neither seed nor winner is client input.
        const snapshot = canonicalMembers(pool.map((p) => ({ membershipId: p.membership.id, slotNumber: p.membership.slotNumber as number })));
        const proof = draw(groupId, cycleId, s.cycle.cycleNumber, snapshot, this.seed());
        requireRule(verifyDraw(proof).valid, "SELECTION_VERIFICATION_FAILED", "Generated verification material is invalid.");
        winner = pool.find((p) => p.membership.id === proof.winnerMembershipId)!;
        result = { id: newId(), groupId, cycleId, cycleNumber: proof.cycleNumber, selectionMethod: "Random", winnerMembershipId: proof.winnerMembershipId,
          winnerUserId: winner.membership.userId, winnerSlotNumber: (proof.canonicalEligibleMembers[proof.selectedIndex] as { slotNumber: number }).slotNumber,
          eligibleMemberCount: proof.canonicalEligibleMembers.length, executedAt: now, executedByUserId: actor.userId, algorithmVersion: proof.algorithmVersion,
          randomSourceType: RANDOM_SOURCE_TYPE, seedCommitment: proof.seedCommitment, seedReveal: proof.seedReveal, eligibleSetHash: proof.eligibleSetHash,
          resultHash: proof.resultHash, selectedIndex: proof.selectedIndex, eligibleMembers: proof.canonicalEligibleMembers.map((m, i) => ({ ...m, ordinal: i })) };
      }
      const memberBefore = groupRepository.membershipSnapshot(winner.membership);
      const cycleBefore = cycleRepository.cycleSnapshot(s.cycle);
      selectForPayout(winner.membership, s.cycle.cycleNumber, now);
      completeSelection(s.cycle, result.id, now);
      await insertSelectionResult(tx, result);
      await groupRepository.saveMembership(tx, winner.membership, memberBefore);
      await cycleRepository.saveCycle(tx, s.cycle, cycleBefore);
      for (const action of [result.selectionMethod === "Random" ? "RANDOM_DRAW_EXECUTED" : "ORGANIZER_RESERVED_SELECTION_EXECUTED", "SELECTION_RESULT_CREATED", "MEMBER_SELECTED_FOR_PAYOUT", "CYCLE_SELECTION_COMPLETED"])
        await writeGroupAudit(tx, audit(result, actor, action, now));
      await this.ledger.post(tx, result.selectionMethod === "Random" ? "RandomSelectionCompleted" : "OrganizerReservedSelectionCompleted", result.id, actor.userId);
      s.existingResult = result;
      return map(s, result);
    });
  }

  async get(groupId: string, cycleId: string, actor: Actor) {
    const s = await loadSelectionContext(this.db, groupId, cycleId, actor.userId, false);
    authorizeReader(s, actor);
    if (!s.existingResult) throw new NotFoundError("Selection has not been completed.");
    return map(s, s.existingResult);
  }

  async preview(groupId: string, cycleId: string, actor: Actor) {
    const s = await loadSelectionContext(this.db, groupId, cycleId, actor.userId, false);
    authorizeOperator(s, actor);
    requireReady(s);
    if (s.cycle.selectionMethod === "OrganizerReserved") {
      reservedOrganizer(s);
      return { eligibleMemberCount: 1, algorithmVersion: "ORGANIZER_RESERVED_V1", selectionMethod: "ORGANIZER_RESERVED" };
    }
    const count = eligible(s).length;
    requireRule(count > 0, "NO_ELIGIBLE_MEMBERS", "No eligible members remain.");
    return { eligibleMemberCount: count, algorithmVersion: RANDOM_ALGORITHM_VERSION, selectionMethod: "RANDOM" };
  }

  async verify(groupId: string, cycleId: string, actor: Actor) {
    const s = await loadSelectionContext(this.db, groupId, cycleId, actor.userId, false);
    authorizeReader(s, actor);
    const result = s.existingResult;
    if (!result) throw new NotFoundError("Selection has not been completed.");
    requireRule(result.selectionMethod === "Random", "RANDOM_VERIFICATION_NOT_APPLICABLE", "This selection method does not use random verification.");
    const proof: RandomDrawProof = {
      algorithmVersion: result.algorithmVersion, groupId: result.groupId, cycleId: result.cycleId, cycleNumber: result.cycleNumber,
      canonicalEligibleMembers: result.eligibleMembers.map((m) => ({ membershipId: m.membershipId, slotNumber: m.slotNumber })), eligibleSetHash: result.eligibleSetHash as string,
      seedCommitment: result.seedCommitment as string, seedReveal: result.seedReveal as string, selectedIndex: result.selectedIndex as number,
      winnerMembershipId: result.winnerMembershipId, resultHash: result.resultHash,
    };
    const verification = verifyDraw(proof);
    if (verification.valid) await writeGroupAudit(this.db, audit(result, actor, "RANDOM_DRAW_VERIFIED", this.clock.now()));
    return { selectionResultId: result.id, valid: verification.valid, failureReason: verification.failureReason, proof };
  }
}

const audit = (result: SelectionResult, actor: Actor, action: string, now: Date) => ({
  groupId: result.groupId, actorUserId: actor.userId, action, createdAt: now, subjectId: result.id, cycleId: result.cycleId, selectionResultId: result.id,
  winnerMembershipId: result.winnerMembershipId, algorithmVersion: result.algorithmVersion,
});

export function map(s: SelectionContext, result: SelectionResult) {
  return {
    id: result.id, groupId: result.groupId, cycleId: result.cycleId, cycleNumber: result.cycleNumber, selectionMethod: snakeUpper(result.selectionMethod),
    winner: { membershipId: result.winnerMembershipId, slotNumber: result.winnerSlotNumber,
      displayName: s.participants.find((p) => p.membership.id === result.winnerMembershipId)?.displayName ?? "Unavailable member" },
    eligibleMemberCount: result.eligibleMemberCount, executedAt: result.executedAt, algorithmVersion: result.algorithmVersion, verificationAvailable: result.selectionMethod === "Random",
  };
}
