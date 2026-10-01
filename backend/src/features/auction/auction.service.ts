import type { AuctionConfig } from "../../config/auction.js";
import type { GroupMemberPolicy } from "../../config/groups.js";
import type { Database, Queryable, Tx } from "../../infra/database/db.js";
import type { Actor, Clock } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { newId, sha256HexLower } from "../../utils/crypto.js";
import { roundTripUtc, utcInstant } from "../../utils/dates.js";
import { snakeUpper } from "../../utils/enums.js";
import { BusinessRuleError, requireGroup, requireRule } from "../../utils/errors.js";
import { findReceipts, insertReceipt, type Receipt, Scopes, validateReplay } from "../../utils/idempotency.js";
import { Decimal } from "../../utils/money.js";
import { writeAuditLog, writeGroupAudit } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { completeSelection } from "../cycle/cycle.domain.js";
import { cycleRepository } from "../cycle/cycle.repository.js";
import { selectForPayout } from "../group/group.domain.js";
import { groupRepository } from "../group/group.repository.js";
import type { LedgerPostingService } from "../ledger/ledger.posting.js";
import { organizerRepository } from "../organizer/organizer.repository.js";
import { auctionResultHash, canonicalMembers } from "../random-draw/random-draw.algorithm.js";
import { insertSelectionResult, loadSelectionContext, type SelectionContext, type SelectionResult } from "../random-draw/selection.context.js";
import { authorizeReader, eligible, requireContributionsReady } from "../random-draw/selection.policy.js";
import * as domain from "./auction.domain.js";
import type { Auction, AuctionBid, AuctionResult, ClosingTransition, RescheduleReason } from "./auction.domain.js";
import { auctionRepository } from "./auction.repository.js";

/** Notified after every committed auction change so the next durable BullMQ job can be scheduled. */
export interface AuctionScheduleSync { sync(target: { groupId: string; cycleId: string }): Promise<void> }
export const noopScheduleSync: AuctionScheduleSync = { sync: async () => undefined };

export interface RescheduleInput {
  newStartsAt: Date; newEndsAt: Date; reasonCode: RescheduleReason | null; reasonText?: string | null; memberMessage?: string | null; expectedScheduleVersion?: number | null;
}

/** In-transaction auction state (AuctionContext). */
interface AuctionState {
  selection: SelectionContext;
  auction: Auction | null;
  auctionBefore: ReturnType<typeof auctionRepository.snapshot> | null;
  auctionCreated: boolean;
  result: AuctionResult | null;
  bids: AuctionBid[];
  receipts: Receipt[];
  audit: Array<{ Action: string; CreatedAt: Date; SubjectId: string | null }>;
}

/** Outcome of an automation step, for logs and tests. */
export type AutomationOutcome = { outcome: "NOOP"; reason: string } | { outcome: "APPLIED"; actions: string[] };

const FINALIZATION_ACTIONS = ["AUCTION_CLOSED", "AUCTION_WINNER_SELECTED", "AUCTION_CALCULATION_FINALIZED", "AUCTION_MEMBER_BENEFITS_CALCULATED",
  "AUCTION_PLATFORM_FEE_CALCULATED", "CYCLE_AUCTION_SELECTION_COMPLETED", "MEMBER_SELECTED_FOR_PAYOUT"];

/**
 * Port of AuctionService. Every write runs in one READ COMMITTED transaction holding, in order, the group, cycle and
 * auction row locks (SELECT … FOR UPDATE), exactly like AuctionStore. Reads use a REPEATABLE READ snapshot.
 * The digital closing sequence is evaluated deterministically from persisted deadlines inside the same lock, so a
 * bid and a worker job can never both "win" the same moment: PostgreSQL row-lock order decides.
 */
export class AuctionService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly config: AuctionConfig, private readonly policy: GroupMemberPolicy,
    private readonly ledger: LedgerPostingService, private readonly scheduleSync: AuctionScheduleSync = noopScheduleSync) {}

  // ---- state loading ---------------------------------------------------------------------------------------------

  private async load(db: Queryable, groupId: string, cycleId: string, actorId: string | null, write: boolean): Promise<AuctionState> {
    if (write) {
      await db.query(`SELECT 1 FROM groups."Groups" WHERE "Id" = $1 FOR UPDATE`, [groupId]);
      await db.query(`SELECT 1 FROM groups."MonthlyCycles" WHERE "GroupId" = $1 AND "Id" = $2 FOR UPDATE`, [groupId, cycleId]);
      await db.query(`SELECT 1 FROM groups."Auctions" WHERE "GroupId" = $1 AND "CycleId" = $2 FOR UPDATE`, [groupId, cycleId]);
    }
    const selection = await loadSelectionContext(db, groupId, cycleId, actorId, false);
    const auction = await auctionRepository.forCycle(db, groupId, cycleId);
    return {
      selection, auction, auctionBefore: auction && auctionRepository.snapshot(auction), auctionCreated: false,
      result: await auctionRepository.result(db, groupId, cycleId),
      bids: await auctionRepository.bids(db, groupId, cycleId),
      receipts: actorId ? await findReceipts(db, [Scopes.bid(groupId, cycleId, actorId), Scopes.reschedule(groupId, cycleId, actorId)]) : [],
      audit: await auctionRepository.auditFor(db, groupId, cycleId),
    };
  }

  private async write<T>(groupId: string, cycleId: string, actorId: string | null, fn: (tx: Tx, s: AuctionState) => Promise<T>): Promise<T> {
    const result = await this.db.transaction(async (tx) => {
      const s = await this.load(tx, groupId, cycleId, actorId, true);
      return fn(tx, s);
    });
    // After commit only: schedule the next durable job. Failure here never undoes the committed change (the sweep recovers).
    await this.scheduleSync.sync({ groupId, cycleId }).catch(() => undefined);
    return result;
  }

  private read<T>(groupId: string, cycleId: string, actorId: string, fn: (s: AuctionState) => T): Promise<T> {
    return this.db.transaction(async (tx) => fn(await this.load(tx, groupId, cycleId, actorId, false)), "REPEATABLE READ");
  }

  // ---- rules shared by commands ----------------------------------------------------------------------------------

  private active(s: AuctionState): void {
    requireRule(s.selection.group.status !== "Suspended", "GROUP_SUSPENDED", "Auction operations are blocked while the group is suspended.");
    requireRule(s.selection.group.status === "Active", "GROUP_NOT_ACTIVE", "Group must be active.");
  }
  private canManage(s: AuctionState, actor: Actor): boolean {
    const g = s.selection.group;
    return s.selection.actorActive && (g.creatorType === "Platform" ? actor.isAdmin : g.createdByUserId === actor.userId && s.selection.organizerApproved);
  }
  private canInspect(s: AuctionState, actor: Actor): boolean {
    return actor.isAdmin || (s.selection.group.creatorType === "Organizer" && s.selection.group.createdByUserId === actor.userId);
  }
  /** Rescheduling authority: any admin, or the owning approved organizer. Membership grants nothing. */
  private canReschedule(s: AuctionState, actor: Actor): boolean {
    const g = s.selection.group;
    return s.selection.actorActive && (actor.isAdmin || (g.creatorType === "Organizer" && g.createdByUserId === actor.userId && s.selection.organizerApproved));
  }
  private manage(s: AuctionState, actor: Actor): void {
    requireGroup(this.canManage(s, actor), "NOT_AUTHORIZED_TO_MANAGE_AUCTION", "Only the owning approved organizer or a platform-group administrator can manage this auction.");
    this.active(s);
  }
  private method(s: AuctionState): void {
    requireRule(s.selection.cycle.selectionMethod === "Auction", "CYCLE_NOT_AUCTION", "This cycle does not use auction selection.");
  }
  private ready(s: AuctionState): void {
    this.method(s);
    requireRule(s.selection.existingResult === null, "AUCTION_RESULT_ALREADY_EXISTS", "A selection result already exists.");
    requireContributionsReady(s.selection);
  }
  private existing(s: AuctionState): Auction {
    if (!s.auction) throw new BusinessRuleError("AUCTION_NOT_FOUND", "The auction has not been opened.");
    return s.auction;
  }
  /** Prompt 3 published auction times as UTC clock times; the cycle's selection date supplies the calendar day. */
  private window(s: AuctionState): { start: Date; end: Date } {
    const rules = s.selection.group.rules.auctionRules;
    if (!rules) throw new BusinessRuleError("INVALID_AUCTION_RULES", "Published auction configuration is required.");
    return { start: utcInstant(s.selection.cycle.selectionDate, rules.auctionStartTime), end: utcInstant(s.selection.cycle.selectionDate, rules.auctionEndTime) };
  }
  private scheduled(s: AuctionState, now: Date): Auction {
    const g = s.selection.group; const c = s.selection.cycle;
    const { start, end } = this.window(s);
    return domain.scheduleAuction(newId(), g.id, c.id, c.cycleNumber, g.groupValue, g.memberLimit, g.rules.auctionRules!, start, end, now, this.policy);
  }
  private ensureAuction(s: AuctionState, now: Date): Auction {
    if (!s.auction) { s.auction = this.scheduled(s, now); s.auctionCreated = true; }
    return s.auction;
  }

  private async persist(tx: Tx, s: AuctionState): Promise<void> {
    if (!s.auction) return;
    if (s.auctionCreated) { await auctionRepository.insert(tx, s.auction); s.auctionCreated = false; s.auctionBefore = auctionRepository.snapshot(s.auction); }
    else if (s.auctionBefore) await auctionRepository.save(tx, s.auction, s.auctionBefore);
  }

  private async audit(tx: Tx, s: AuctionState, actorId: string, action: string, now: Date, subjectId?: string | null, selection?: SelectionResult): Promise<void> {
    await writeGroupAudit(tx, { groupId: s.selection.group.id, actorUserId: actorId, action, createdAt: now, subjectId: subjectId ?? s.auction?.id ?? null,
      cycleId: s.selection.cycle.id, selectionResultId: selection?.id ?? null, winnerMembershipId: selection?.winnerMembershipId ?? null, algorithmVersion: domain.CALCULATION_VERSION });
    s.audit.push({ Action: action, CreatedAt: now, SubjectId: subjectId ?? s.auction?.id ?? null });
  }

  private async auditTransitions(tx: Tx, s: AuctionState, actorId: string, transitions: ClosingTransition[], now: Date): Promise<string[]> {
    const actions: string[] = [];
    for (const t of transitions) {
      const action = t.kind === "STARTED" ? "AUCTION_CLOSING_STARTED" : t.kind === "RESET_BY_BID" ? "AUCTION_CLOSING_RESET_BY_BID"
        : t.phase === "FINALIZING" ? "AUCTION_FINALIZING" : `AUCTION_CLOSING_${t.phase}`;
      await this.audit(tx, s, actorId, action, now);
      actions.push(action);
    }
    return actions;
  }

  // ---- commands --------------------------------------------------------------------------------------------------

  async open(groupId: string, cycleId: string, actor: Actor) {
    return this.write(groupId, cycleId, actor.userId, async (tx, s) => {
      this.manage(s, actor); this.ready(s);
      // A row exists before opening only when the auction was rescheduled while SCHEDULED; it opens on that window.
      requireRule(s.auction === null || s.auction.status === "Scheduled", "AUCTION_ALREADY_EXISTS", "An auction already exists for this cycle.");
      const now = this.clock.now();
      const created = s.auction === null;
      domain.open(this.ensureAuction(s, now), now);
      await this.persist(tx, s);
      if (created) await this.audit(tx, s, actor.userId, "AUCTION_CREATED", now);
      await this.audit(tx, s, actor.userId, "AUCTION_OPENED", now);
      return this.map(s, actor, now);
    });
  }

  async bid(groupId: string, cycleId: string, actor: Actor, discount: Decimal, key: string) {
    return this.write(groupId, cycleId, actor.userId, async (tx, s) => {
      authorizeReader(s.selection, actor); this.method(s);
      const auction = this.existing(s);
      requireRule(!!key && key.trim().length > 0 && key.length <= 128, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key of at most 128 characters.");
      const scope = Scopes.bid(groupId, cycleId, actor.userId);
      const fingerprint = sha256HexLower(`${scope}\n${discount.toFixed(Math.max(2, discount.decimalPlaces()))}`);
      const receipt = s.receipts.find((r) => r.scope === scope && r.key === key);
      if (receipt) {
        validateReplay(receipt, fingerprint);
        return acceptedBid(s, s.bids.find((b) => b.id === receipt.resultId)!);
      }
      this.active(s); domain.ensureOpen(auction);
      const participant = s.selection.participants.find((p) => p.membership.userId === actor.userId);
      requireRule(participant !== undefined, "MEMBER_NOT_ELIGIBLE_TO_BID", "Only active group members can bid.");
      requireRule(!participant.membership.hasBeenSelectedForPayout, "MEMBER_ALREADY_SELECTED_FOR_PAYOUT", "Members already selected for main payout cannot bid again.");
      requireRule(eligible(s.selection).some((p) => p.membership.id === participant.membership.id), "MEMBER_NOT_ELIGIBLE_TO_BID", "Your membership and current contribution must be eligible.");
      this.ready(s);
      const now = this.clock.now();
      const { bid, transitions } = domain.placeBid(auction, newId(), participant.membership.id, discount, key, now, this.config, this.policy);
      s.bids.push(bid);
      // The bid row first: the auction's CurrentWinningBidId is a foreign key to it.
      await auctionRepository.insertBid(tx, bid);
      await this.persist(tx, s);
      await insertReceipt(tx, { id: newId(), scope, key, requestHash: fingerprint, resultId: bid.id, createdAt: now });
      await this.audit(tx, s, actor.userId, "AUCTION_BID_SUBMITTED", now, bid.id);
      await this.auditTransitions(tx, s, actor.userId, transitions, now);
      return acceptedBid(s, bid);
    });
  }

  /** Manual close by the operator (existing behavior): finalizes immediately with the current highest bid. */
  async close(groupId: string, cycleId: string, actor: Actor) {
    return this.write(groupId, cycleId, actor.userId, async (tx, s) => {
      this.manage(s, actor); this.method(s);
      const auction = this.existing(s); const now = this.clock.now();
      if (auction.status === "WinnerSelected" || auction.status === "ClosedNoBids") return this.map(s, actor, now);
      domain.ensureOpen(auction); this.ready(s);
      await this.finalize(tx, s, actor.userId, now);
      return this.map(s, actor, now);
    });
  }

  /** Close with or without a winner, create the immutable selection + calculation, and post the funded ledger journal. */
  private async finalize(tx: Tx, s: AuctionState, actorId: string, now: Date): Promise<string[]> {
    const auction = s.auction!;
    const winner = domain.winningBid(s.bids);
    if (!winner) {
      domain.close(auction, null, now);
      await this.persist(tx, s);
      await this.audit(tx, s, actorId, "AUCTION_CLOSED", now); await this.audit(tx, s, actorId, "AUCTION_CLOSED_NO_BIDS", now);
      return ["AUCTION_CLOSED", "AUCTION_CLOSED_NO_BIDS"];
    }
    const pool = eligible(s.selection);
    const participant = pool.find((p) => p.membership.id === winner.membershipId);
    requireRule(participant !== undefined, "MEMBER_NOT_ELIGIBLE_TO_BID", "The highest bidder is no longer eligible. The auction remains unresolved for authorized intervention.");
    const member = participant.membership;
    const snapshot = canonicalMembers(pool.map((p) => ({ membershipId: p.membership.id, slotNumber: p.membership.slotNumber as number })));
    requireRule(snapshot.some((m) => m.membershipId === member.id), "MEMBER_NOT_ELIGIBLE_TO_BID", "Winning membership must be in the eligible selection snapshot.");
    const selection: SelectionResult = {
      id: newId(), groupId: auction.groupId, cycleId: auction.cycleId, cycleNumber: auction.cycleNumber, selectionMethod: "Auction", winnerMembershipId: member.id,
      winnerUserId: member.userId, winnerSlotNumber: member.slotNumber as number, eligibleMemberCount: snapshot.length, executedAt: now, executedByUserId: actorId,
      algorithmVersion: domain.CALCULATION_VERSION, randomSourceType: null, seedCommitment: null, seedReveal: null, eligibleSetHash: null,
      resultHash: auctionResultHash(auction.groupId, auction.cycleId, auction.cycleNumber, winner.id, member.id), selectedIndex: null,
      eligibleMembers: snapshot.map((m, i) => ({ ...m, ordinal: i })),
    };
    // Obligations identify every original member position, including prior main-payout recipients.
    const recipients = s.selection.contributions.map((c) => c.membershipId);
    const result = domain.createResult(newId(), auction, winner, selection.id, recipients, actorId, now, newId, this.policy);
    const memberBefore = groupRepository.membershipSnapshot(member);
    const cycleBefore = cycleRepository.cycleSnapshot(s.selection.cycle);
    domain.close(auction, winner, now);
    selectForPayout(member, auction.cycleNumber, now);
    completeSelection(s.selection.cycle, selection.id, now);
    await this.persist(tx, s);
    await insertSelectionResult(tx, selection);
    await auctionRepository.insertResult(tx, result);
    await groupRepository.saveMembership(tx, member, memberBefore);
    await cycleRepository.saveCycle(tx, s.selection.cycle, cycleBefore);
    s.result = result; s.selection.existingResult = selection;
    for (const action of FINALIZATION_ACTIONS) await this.audit(tx, s, actorId, action, now, result.id, selection);
    await this.ledger.post(tx, "AuctionSelectionCompleted", selection.id, actorId);
    return FINALIZATION_ACTIONS;
  }

  async reschedule(groupId: string, cycleId: string, actor: Actor, input: RescheduleInput, key: string) {
    return this.write(groupId, cycleId, actor.userId, async (tx, s) => {
      requireGroup(this.canReschedule(s, actor), "AUCTION_PERMISSION_DENIED", "Only the group's approved organizer or a Dhanvi administrator can reschedule this auction.");
      this.active(s); this.method(s);
      requireRule(!!key && key.trim().length > 0 && key.length <= 128, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key of at most 128 characters.");
      requireRule(input.reasonCode !== null && input.reasonCode !== undefined, "AUCTION_RESCHEDULE_REASON_REQUIRED", "Choose a reason for the schedule change.");
      const reasonCode = input.reasonCode;
      const { reasonText, memberMessage } = domain.validateRescheduleReason(reasonCode, input.reasonText, input.memberMessage);
      const scope = Scopes.reschedule(groupId, cycleId, actor.userId);
      const fingerprint = sha256HexLower(`${scope}\n${roundTripUtc(input.newStartsAt)}\n${roundTripUtc(input.newEndsAt)}\n${reasonCode}\n${reasonText ?? ""}\n${memberMessage ?? ""}`);
      const receipt = s.receipts.find((r) => r.scope === scope && r.key === key);
      // A retried request returns the outcome it already produced: no second history row, no second audit event.
      if (receipt) { validateReplay(receipt, fingerprint); return this.map(s, actor, this.clock.now()); }
      requireRule(s.selection.existingResult === null && s.result === null, "AUCTION_ALREADY_COMPLETED", "This cycle's auction has a result; its timing is immutable.");
      const now = this.clock.now();
      const created = s.auction === null;
      const auction = this.ensureAuction(s, now);
      // Optimistic check on top of the row lock: the operator must have seen the schedule they are replacing.
      const currentVersion = created ? 0 : auction.version;
      requireRule(input.expectedScheduleVersion === null || input.expectedScheduleVersion === undefined || input.expectedScheduleVersion === currentVersion,
        "AUCTION_SCHEDULE_CONFLICT", "The auction schedule was changed by another user. Review the updated schedule before making another change.");
      const previous = domain.reschedule(auction, input.newStartsAt, input.newEndsAt, reasonCode, memberMessage, now);
      const changeId = newId();
      await this.persist(tx, s);
      await auctionRepository.insertScheduleChange(tx, { id: changeId, auctionId: auction.id, groupId, cycleId, changeSequence: auction.rescheduleCount,
        previousStartsAt: previous.previousStartsAt, previousEndsAt: previous.previousEndsAt, newStartsAt: input.newStartsAt, newEndsAt: input.newEndsAt, reasonCode,
        reasonText, memberMessage, changedByUserId: actor.userId, changedByRole: actor.isAdmin ? "ADMIN" : "ORGANIZER", changedAt: now });
      await insertReceipt(tx, { id: newId(), scope, key, requestHash: fingerprint, resultId: changeId, createdAt: now });
      if (created) await this.audit(tx, s, actor.userId, "AUCTION_CREATED", now);
      await this.audit(tx, s, actor.userId, "AUCTION_RESCHEDULED", now, changeId);
      return this.map(s, actor, now);
    });
  }

  // ---- automation (BullMQ workers) -------------------------------------------------------------------------------

  /**
   * OPEN_AUCTION: opens the auction at its authoritative StartsAt when the cycle is ready. Acts on behalf of the group
   * owner (actor columns are foreign keys to real users). NO-OP when anything changed since the job was scheduled.
   */
  async automationOpen(groupId: string, cycleId: string, expectedStartsAt: number, jobId: string): Promise<AutomationOutcome> {
    return this.write(groupId, cycleId, null, async (tx, s) => {
      const g = s.selection.group;
      if (g.status !== "Active") return noop("GROUP_NOT_ACTIVE");
      if (s.selection.cycle.selectionMethod !== "Auction") return noop("CYCLE_NOT_AUCTION");
      if (s.auction && s.auction.status !== "Scheduled") return noop("AUCTION_NOT_SCHEDULED");
      if (!s.selection.organizerApproved) return noop("ORGANIZER_NOT_APPROVED");
      const now = this.clock.now();
      const startsAt = s.auction?.startsAt ?? this.window(s).start;
      if (startsAt.getTime() !== expectedStartsAt) return noop("STALE_SCHEDULE");
      try { this.ready(s); } catch { return noop("CYCLE_NOT_READY"); }
      const created = s.auction === null;
      const auction = this.ensureAuction(s, now);
      if (now.getTime() < auction.startsAt.getTime() || now.getTime() >= auction.endsAt.getTime()) return noop("OUTSIDE_WINDOW");
      domain.open(auction, now);
      await this.persist(tx, s);
      const actions = created ? ["AUCTION_CREATED", "AUCTION_OPENED"] : ["AUCTION_OPENED"];
      for (const action of actions) await this.audit(tx, s, g.createdByUserId, action, now);
      await writeAuditLog(tx, { actorUserId: null, action: "AUCTION_AUTOMATION_OPENED", entityType: "Auction", entityId: auction.id, timestamp: now, correlationId: jobId });
      return { outcome: "APPLIED", actions };
    });
  }

  /**
   * START_CLOSING_SEQUENCE / ADVANCE_* / FINALIZE_AUCTION. Reloads authoritative state under the row locks and
   * NO-OPs when the job is stale (ClosingVersion or highest bid moved on). Duplicate jobs therefore cannot produce a
   * second transition, winner, selection result, allocation or journal; the unique indexes back this up.
   */
  async automationClose(groupId: string, cycleId: string, expected: { closingVersion: number; highestBidId?: string | null }, jobId: string): Promise<AutomationOutcome> {
    return this.write(groupId, cycleId, null, async (tx, s) => {
      const auction = s.auction;
      if (!auction || auction.status !== "Open") return noop("AUCTION_NOT_OPEN");
      if (auction.closingVersion !== expected.closingVersion) return noop("STALE_CLOSING_VERSION");
      if (expected.highestBidId !== undefined && (expected.highestBidId ?? null) !== auction.currentWinningBidId) return noop("STALE_HIGHEST_BID");
      const now = this.clock.now();
      const owner = s.selection.group.createdByUserId;
      const transitions = domain.advanceClosing(auction, now, this.config);
      const actions = await this.auditTransitions(tx, s, owner, transitions, now);
      if (auction.closingPhase === "FINALIZING" || domain.endedWithoutBids(auction, now)) {
        if (s.selection.group.status !== "Active") { await this.persist(tx, s); return actions.length ? { outcome: "APPLIED", actions } : noop("GROUP_NOT_ACTIVE"); }
        this.ready(s);
        actions.push(...(await this.finalize(tx, s, owner, now)));
      } else await this.persist(tx, s);
      if (actions.length === 0) return noop("NOT_DUE");
      await writeAuditLog(tx, { actorUserId: null, action: "AUCTION_AUTOMATION_APPLIED", entityType: "Auction", entityId: auction.id, timestamp: now, correlationId: jobId });
      return { outcome: "APPLIED", actions };
    });
  }

  /** What the next durable job should be, read from committed state (used by the scheduler and the sweep). */
  async nextJob(groupId: string, cycleId: string): Promise<NextAuctionJob | null> {
    const s = await this.load(this.db, groupId, cycleId, null, false);
    const g = s.selection.group; const c = s.selection.cycle; const a = s.auction;
    if (g.status !== "Active" || c.selectionMethod !== "Auction") return null;
    if (!a || a.status === "Scheduled") {
      if (c.status !== "ReadyForSelection" || c.cycleNumber !== g.currentCycleNumber || s.selection.existingResult) return null;
      const startsAt = a?.startsAt ?? this.window(s).start; const endsAt = a?.endsAt ?? this.window(s).end;
      if (this.clock.now().getTime() >= endsAt.getTime()) return null;
      return { type: "OPEN_AUCTION", groupId, cycleId, dueAt: startsAt, expectedStartsAt: startsAt.getTime(), jobKey: `${c.id}:${startsAt.getTime()}` };
    }
    if (a.status !== "Open") return null;
    const base = { groupId, cycleId, auctionId: a.id, expectedClosingVersion: a.closingVersion };
    switch (a.closingPhase) {
      case null: return a.lastBidSequence === 0
        ? { ...base, type: "FINALIZE_AUCTION", dueAt: a.endsAt, expectedHighestBidId: null, jobKey: `${a.id}:v${a.closingVersion}:nobids:${a.endsAt.getTime()}` }
        : { ...base, type: "START_CLOSING_SEQUENCE", dueAt: a.endsAt, jobKey: `${a.id}:v${a.closingVersion}:${a.endsAt.getTime()}` };
      case "GOING_ONCE": return { ...base, type: "ADVANCE_GOING_ONCE", dueAt: a.closingPhaseEndsAt!, jobKey: `${a.id}:v${a.closingVersion}` };
      case "GOING_TWICE": return { ...base, type: "ADVANCE_GOING_TWICE", dueAt: a.closingPhaseEndsAt!, jobKey: `${a.id}:v${a.closingVersion}` };
      case "FINAL_WARNING": return { ...base, type: "ADVANCE_FINAL_CALL", dueAt: a.closingPhaseEndsAt!, jobKey: `${a.id}:v${a.closingVersion}` };
      case "FINALIZING": return { ...base, type: "FINALIZE_AUCTION", dueAt: this.clock.now(), expectedHighestBidId: a.currentWinningBidId, jobKey: `${a.id}:v${a.closingVersion}` };
    }
  }

  // ---- queries ---------------------------------------------------------------------------------------------------

  get(groupId: string, cycleId: string, actor: Actor) {
    return this.read(groupId, cycleId, actor.userId, (s) => { authorizeReader(s.selection, actor); this.method(s); return this.map(s, actor, this.clock.now()); });
  }

  myBids(groupId: string, cycleId: string, actor: Actor) {
    return this.read(groupId, cycleId, actor.userId, (s) => { authorizeReader(s.selection, actor); this.method(s); return ownBids(s, actor); });
  }

  result(groupId: string, cycleId: string, actor: Actor) {
    return this.read(groupId, cycleId, actor.userId, (s) => {
      authorizeReader(s.selection, actor); this.method(s);
      requireRule(s.result !== null, s.auction?.status === "ClosedNoBids" ? "AUCTION_HAS_NO_BIDS" : "AUCTION_RESULT_NOT_FOUND", "No auction winner calculation exists.");
      return this.resultMap(s, actor);
    });
  }

  async scheduleHistory(groupId: string, cycleId: string, actor: Actor, page: number, pageSize: number) {
    const inspect = await this.read(groupId, cycleId, actor.userId, (s) => { authorizeReader(s.selection, actor); this.method(s); return this.canInspect(s, actor); });
    return readScheduleHistory(this.db, groupId, cycleId, page, pageSize, inspect);
  }

  async groupScheduleHistory(groupId: string, cycleId: string | undefined, actor: Actor, page: number, pageSize: number) {
    let owns = false;
    if (!actor.isAdmin) {
      const g = await groupRepository.find(this.db, groupId);
      owns = g !== null && g.creatorType === "Organizer" && g.createdByUserId === actor.userId && (await organizerRepository.isApproved(this.db, actor.userId));
    }
    requireGroup(actor.isAdmin || owns, "AUCTION_PERMISSION_DENIED", "Only the group's organizer or a Dhanvi administrator can view the full schedule history.");
    return readScheduleHistory(this.db, groupId, cycleId, page, pageSize, true);
  }

  // ---- mapping ---------------------------------------------------------------------------------------------------

  private resultMap(s: AuctionState, actor: Actor) {
    const r = s.result!;
    const winner = s.selection.participants.find((p) => p.membership.id === r.winnerMembershipId)!;
    const own = s.selection.participants.find((p) => p.membership.userId === actor.userId)?.membership.id;
    return {
      id: r.id, winningBidId: r.winningBidId, winner: { membershipId: winner.membership.id, slotNumber: winner.membership.slotNumber, displayName: winner.displayName },
      groupValue: r.groupValue, winningDiscount: r.winningDiscount, winnerPayout: r.winnerPayout, grossMemberShare: r.grossMemberShare, platformFee: r.platformFee,
      memberBenefitPool: r.memberBenefitPool, nonWinnerCount: r.memberLimit - 1, feePolicy: snakeUpper(r.feePolicy), calculationVersion: r.calculationVersion, finalizedAt: r.finalizedAt,
      myBenefitAllocation: own ? r.allocations.filter((a) => a.membershipId === own).reduce((sum, a) => sum.plus(a.amount), new Decimal(0)) : null,
      allocations: this.canInspect(s, actor) ? r.allocations.map((a) => ({ membershipId: a.membershipId, allocationType: snakeUpper(a.allocationType), amount: a.amount })) : [],
      allocationStatus: "CALCULATED_PENDING_SETTLEMENT",
    };
  }

  /** AuctionDetails, plus the digital closing-sequence fields (closingState, closingPhaseEndsAt, closingVersion). */
  private map(s: AuctionState, actor: Actor, now: Date) {
    const auction = s.auction ?? this.scheduled(s, now);
    const pool = eligible(s.selection);
    const own = s.selection.participants.find((p) => p.membership.userId === actor.userId);
    const active = s.selection.group.status === "Active";
    const ready = s.selection.cycle.status === "ReadyForSelection";
    const manage = this.canManage(s, actor); const inspect = this.canInspect(s, actor);
    const closing = domain.effectiveClosing(auction, now, this.config);
    const inWindow = now.getTime() >= auction.startsAt.getTime() && now.getTime() < auction.endsAt.getTime();
    const inClosingBidPhase = closing.state === "GOING_ONCE" || closing.state === "GOING_TWICE" || closing.state === "FINAL_WARNING";
    const next = auction.lastBidSequence > 0 ? auction.currentHighestDiscount.plus(auction.bidIncrement) : Decimal.max(auction.minimumDiscount, new Decimal(s.selection.group.memberLimit).dividedBy(100));
    const canBid = active && ready && (inWindow || inClosingBidPhase) && auction.status === "Open" && next.lte(auction.maximumDiscount) && pool.some((p) => p.membership.userId === actor.userId);
    const reason = canBid ? null : !active ? "Group is not active." : own?.membership.hasBeenSelectedForPayout ? "You already hold a main payout right."
      : auction.status !== "Open" ? "Auction is not open." : closing.state === "FINALIZING" ? "Bidding has closed; the auction is being finalized."
      : !(inWindow || inClosingBidPhase) ? "Outside the configured auction window." : next.gt(auction.maximumDiscount) ? "Maximum discount has been reached."
      : "An active membership and fully recorded contribution are required.";
    const reschedule = this.canReschedule(s, actor) && active;
    const rescheduleReason = !reschedule ? (active ? "Only the group's organizer or a Dhanvi administrator can reschedule." : "Group is not active.")
      : auction.status === "Open" ? "Auction is already live. Schedule changes are unavailable after bidding begins."
      : auction.status !== "Scheduled" || s.result !== null || s.selection.existingResult !== null ? "This auction has closed; its timing is part of the record."
      : auction.lastBidSequence > 0 ? "Bids exist on a scheduled auction; the auction state needs review." : null;
    const slots = new Map(s.selection.participants.map((p) => [p.membership.id, p.membership.slotNumber ?? 0]));
    const rescheduled = auction.rescheduleCount > 0;
    return {
      id: s.auction?.id ?? null, cycleNumber: auction.cycleNumber, status: snakeUpper(auction.status), startsAt: auction.startsAt, endsAt: auction.endsAt, serverTime: now,
      openedAt: auction.openedAt, closedAt: auction.closedAt, winnerSelectedAt: auction.winnerSelectedAt, minimumDiscount: auction.minimumDiscount, maximumDiscount: auction.maximumDiscount,
      bidIncrement: auction.bidIncrement, currentHighestDiscount: auction.currentHighestDiscount, minimumNextBid: next, potentialWinnerPayout: auction.groupValue.minus(auction.currentHighestDiscount),
      bidCount: auction.lastBidSequence, eligibleBidderCount: pool.length, canManage: manage,
      canOpen: manage && active && ready && (s.auction === null || s.auction.status === "Scheduled") && inWindow,
      canClose: manage && active && ready && auction.status === "Open", canBid, bidUnavailableReason: reason,
      myBids: ownBids(s, actor), operationalBids: inspect ? s.bids.map((b) => bidMap(s, b, true)) : [],
      auditHistory: inspect ? s.audit.map((a) => ({ action: a.Action, createdAt: a.CreatedAt, subjectId: a.SubjectId })) : [],
      result: s.result ? this.resultMap(s, actor) : null, groupValue: s.selection.group.groupValue, groupName: s.selection.group.name, durationMonths: s.selection.group.durationMonths,
      recentBids: [...s.bids].sort((x, y) => y.sequenceNumber - x.sequenceNumber).slice(0, 12).map((b) => ({ discountAmount: b.discountAmount, submittedAt: b.submittedAt,
        memberSlot: slots.get(b.membershipId) ?? 0, isMine: b.membershipId === own?.membership.id, isCurrentHighest: s.auction?.currentWinningBidId === b.id })),
      currentLeaderSlot: s.auction?.currentWinningMembershipId ? (slots.get(s.auction.currentWinningMembershipId) ?? null) : null,
      wasRescheduled: rescheduled, lastRescheduledAt: auction.lastRescheduledAt, rescheduleCount: auction.rescheduleCount,
      originalStartsAt: rescheduled ? auction.originalStartsAt : null, originalEndsAt: rescheduled ? auction.originalEndsAt : null,
      previousStartsAt: auction.previousStartsAt, previousEndsAt: auction.previousEndsAt, latestReasonCode: auction.latestReasonCode && snakeUpper(auction.latestReasonCode),
      latestMemberMessage: auction.latestMemberMessage, canReschedule: reschedule && rescheduleReason === null, rescheduleUnavailableReason: rescheduleReason,
      scheduleVersion: s.auction?.version ?? 0,
      // Digital closing sequence (additive fields). The backend state is authoritative; the browser only displays it.
      closingState: closing.state, closingPhaseEndsAt: closing.phaseEndsAt, closingVersion: closing.version, closingStartedAt: auction.closingStartedAt,
      closingDurations: { goingOnceSeconds: this.config.goingOnceSeconds, goingTwiceSeconds: this.config.goingTwiceSeconds, finalWarningSeconds: this.config.finalWarningSeconds },
    };
  }
}

export interface NextAuctionJob {
  type: "OPEN_AUCTION" | "START_CLOSING_SEQUENCE" | "ADVANCE_GOING_ONCE" | "ADVANCE_GOING_TWICE" | "ADVANCE_FINAL_CALL" | "FINALIZE_AUCTION";
  groupId: string; cycleId: string; auctionId?: string; dueAt: Date; jobKey: string;
  expectedStartsAt?: number; expectedClosingVersion?: number; expectedHighestBidId?: string | null;
}

const noop = (reason: string): AutomationOutcome => ({ outcome: "NOOP", reason });

function acceptedBid(s: AuctionState, b: AuctionBid) {
  return { bidId: b.id, discountAmount: b.discountAmount, sequenceNumber: b.sequenceNumber, isCurrentWinningBid: true, currentHighestDiscount: b.discountAmount,
    potentialWinnerPayout: s.auction!.groupValue.minus(b.discountAmount), submittedAt: b.submittedAt, memberSlot: null };
}

function bidMap(s: AuctionState, b: AuctionBid, inspect = false) {
  return { bidId: b.id, discountAmount: b.discountAmount, sequenceNumber: b.sequenceNumber, isCurrentWinningBid: s.auction?.currentWinningBidId === b.id,
    currentHighestDiscount: s.auction?.currentHighestDiscount ?? new Decimal(0), potentialWinnerPayout: s.selection.group.groupValue.minus(b.discountAmount), submittedAt: b.submittedAt,
    memberSlot: inspect ? (s.selection.participants.find((p) => p.membership.id === b.membershipId)?.membership.slotNumber ?? null) : null };
}

function ownBids(s: AuctionState, actor: Actor) {
  const membership = s.selection.participants.find((p) => p.membership.userId === actor.userId)?.membership.id;
  return s.bids.filter((b) => b.membershipId === membership).sort((x, y) => y.sequenceNumber - x.sequenceNumber).map((b) => bidMap(s, b));
}

/** Server-paged, newest-first history: one page, one count, one batched name lookup — never a whole group's history. */
async function readScheduleHistory(db: Queryable, groupId: string, cycleId: string | undefined, page: number, pageSize: number, includeInternal: boolean) {
  page = clamp(page, 1, 100000); pageSize = clamp(pageSize, 1, 50);
  const params: unknown[] = [groupId]; let where = `c."GroupId" = $1`;
  if (cycleId) { params.push(cycleId); where += ` AND c."CycleId" = $2`; }
  const total = (await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."AuctionScheduleChanges" c WHERE ${where}`, params)).count;
  const rows = await db.query<Record<string, unknown>>(`SELECT c.*, y."CycleNumber" FROM groups."AuctionScheduleChanges" c LEFT JOIN groups."MonthlyCycles" y ON y."Id" = c."CycleId"
    WHERE ${where} ORDER BY c."ChangedAt" DESC, c."ChangeSequence" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  const names = includeInternal ? await authRepository.directoryMany(db, rows.map((r) => r.ChangedByUserId as string)) : new Map();
  return {
    items: rows.map((r) => ({
      id: r.Id, cycleId: r.CycleId, cycleNumber: r.CycleNumber ?? 0, changeSequence: r.ChangeSequence, previousStartsAt: r.PreviousStartsAt, previousEndsAt: r.PreviousEndsAt,
      newStartsAt: r.NewStartsAt, newEndsAt: r.NewEndsAt, reasonCode: snakeUpper(r.ReasonCode as string), reasonText: includeInternal ? r.ReasonText : null, memberMessage: r.MemberMessage,
      changedByRole: includeInternal ? r.ChangedByRole : null, changedByName: includeInternal ? (names.get(r.ChangedByUserId as string)?.name ?? "Unavailable") : null, changedAt: r.ChangedAt,
    })),
    page, pageSize, totalCount: total,
  };
}
