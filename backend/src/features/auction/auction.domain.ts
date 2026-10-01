import type { AuctionConfig } from "../../config/auction.js";
import type { GroupMemberPolicy } from "../../config/groups.js";
import { addSeconds } from "../../utils/dates.js";
import { requireRule } from "../../utils/errors.js";
import { Decimal, dividesIntoPaise, isPaise } from "../../utils/money.js";
import { contribution } from "../group/group.domain.js";
import type { AuctionFeePolicy, AuctionGroupRules } from "../group/group.types.js";

export const AUCTION_STATUSES = ["Scheduled", "Open", "Closed", "WinnerSelected", "ClosedNoBids"] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];
export const RESCHEDULE_REASONS = ["PublicHoliday", "TechnicalIssue", "OperationalIssue", "OrganizerRequest", "IncorrectSchedule", "MemberAvailability", "Emergency", "Other"] as const;
export type RescheduleReason = (typeof RESCHEDULE_REASONS)[number];

/** Persisted closing phases (Status stays 'Open' throughout). COMPLETED is derived from the terminal status. */
export const CLOSING_PHASES = ["GOING_ONCE", "GOING_TWICE", "FINAL_WARNING", "FINALIZING"] as const;
export type ClosingPhase = (typeof CLOSING_PHASES)[number];
export type ClosingState = ClosingPhase | "COMPLETED";

export const CALCULATION_VERSION = "DHANVI_AUCTION_V1";

export interface Auction {
  id: string; groupId: string; cycleId: string; cycleNumber: number; status: AuctionStatus; startsAt: Date; endsAt: Date;
  groupValue: Decimal; memberLimit: number; minimumDiscount: Decimal; maximumDiscount: Decimal; bidIncrement: Decimal; feePolicy: AuctionFeePolicy;
  currentHighestDiscount: Decimal; currentWinningBidId: string | null; currentWinningMembershipId: string | null; lastBidSequence: number;
  openedAt: Date | null; closedAt: Date | null; winnerSelectedAt: Date | null; createdAt: Date; updatedAt: Date; version: number;
  rescheduleCount: number; lastRescheduledAt: Date | null; originalStartsAt: Date; originalEndsAt: Date; previousStartsAt: Date | null; previousEndsAt: Date | null;
  latestReasonCode: RescheduleReason | null; latestMemberMessage: string | null;
  closingPhase: ClosingPhase | null; closingPhaseEndsAt: Date | null; closingStartedAt: Date | null; closingVersion: number;
}

export interface AuctionBid {
  id: string; auctionId: string; groupId: string; cycleId: string; membershipId: string; discountAmount: Decimal; sequenceNumber: number; idempotencyKey: string; submittedAt: Date;
}

export interface AuctionCalculation { winnerPayout: Decimal; grossMemberShare: Decimal; platformFee: Decimal; memberBenefitPool: Decimal; benefitPerNonWinner: Decimal; nonWinnerCount: number }

/**
 * AuctionCalculator (DHANVI_AUCTION_V1, WinnerMemberShare). Example: value ₹50,000, winning discount ₹5,000, 10 members
 * → winner payout ₹45,000; share ₹500 = platform fee; each of the 9 other members receives ₹500 (pool ₹4,500).
 */
export function calculate(groupValue: Decimal, memberLimit: number, discount: Decimal, policy: AuctionFeePolicy, memberPolicy?: GroupMemberPolicy): AuctionCalculation {
  contribution(groupValue, memberLimit, memberPolicy);
  requireRule(policy === "WinnerMemberShare", "UNSUPPORTED_AUCTION_FEE_POLICY", "This fee policy is not implemented.");
  requireRule(discount.gt(0) && discount.lt(groupValue) && isPaise(discount), "INVALID_DISCOUNT", "Discount must be positive, below the group value, and exact to two decimal places.");
  requireRule(dividesIntoPaise(discount, memberLimit), "INVALID_AUCTION_ALLOCATION_PRECISION", "Discount divided by all member positions must be exact to two decimal places.");
  const share = discount.dividedBy(memberLimit);
  return { winnerPayout: groupValue.minus(discount), grossMemberShare: share, platformFee: share, memberBenefitPool: discount.minus(share), benefitPerNonWinner: share, nonWinnerCount: memberLimit - 1 };
}

const touch = (a: Auction, now: Date) => { a.updatedAt = now; a.version += 1; };

/** Auction.Schedule */
export function scheduleAuction(id: string, groupId: string, cycleId: string, number: number, value: Decimal, members: number, rules: AuctionGroupRules,
  start: Date, end: Date, now: Date, memberPolicy?: GroupMemberPolicy): Auction {
  requireRule(start.getTime() < end.getTime() && rules.minimumDiscount.gte(0) && rules.minimumDiscount.lte(rules.maximumDiscount) && rules.bidIncrement.gt(0) && rules.bidIncrement.lt(value),
    "INVALID_AUCTION_RULES", "Auction limits, increment and window must be valid.");
  calculate(value, members, rules.maximumDiscount, rules.feePolicy, memberPolicy);
  requireRule(dividesIntoPaise(rules.minimumDiscount, members) && dividesIntoPaise(rules.bidIncrement, members), "INVALID_AUCTION_ALLOCATION_PRECISION", "Configured limits and increment must support exact member shares.");
  return {
    id, groupId, cycleId, cycleNumber: number, status: "Scheduled", startsAt: start, endsAt: end, groupValue: value, memberLimit: members,
    minimumDiscount: rules.minimumDiscount, maximumDiscount: rules.maximumDiscount, bidIncrement: rules.bidIncrement, feePolicy: rules.feePolicy,
    currentHighestDiscount: new Decimal(0), currentWinningBidId: null, currentWinningMembershipId: null, lastBidSequence: 0, openedAt: null, closedAt: null, winnerSelectedAt: null,
    createdAt: now, updatedAt: now, version: 0, rescheduleCount: 0, lastRescheduledAt: null, originalStartsAt: start, originalEndsAt: end, previousStartsAt: null, previousEndsAt: null,
    latestReasonCode: null, latestMemberMessage: null, closingPhase: null, closingPhaseEndsAt: null, closingStartedAt: null, closingVersion: 0,
  };
}

/** Auction.Reschedule — SCHEDULED and bid-free only; returns the replaced window for the append-only history. */
export function reschedule(a: Auction, newStart: Date, newEnd: Date, reason: RescheduleReason, memberMessage: string | null, now: Date): { previousStartsAt: Date; previousEndsAt: Date } {
  requireRule(a.status !== "Open", "AUCTION_ALREADY_OPEN", "Schedule changes are unavailable after bidding begins.");
  requireRule(a.status === "Scheduled", "AUCTION_ALREADY_COMPLETED", "A closed auction's timing is part of its record and cannot change.");
  requireRule(a.lastBidSequence === 0, "AUCTION_RESCHEDULE_NOT_ALLOWED", "Bids exist for an auction that is not open; the auction state is inconsistent and needs review before any schedule change.");
  requireRule(newStart.getTime() < newEnd.getTime(), "AUCTION_INVALID_TIME_RANGE", "The auction must end after it starts.");
  requireRule(newStart.getTime() > now.getTime(), "AUCTION_NEW_START_IN_PAST", "The new start must be in the future.");
  requireRule(newStart.getTime() !== a.startsAt.getTime() || newEnd.getTime() !== a.endsAt.getTime(), "AUCTION_SCHEDULE_UNCHANGED", "Choose a different date or time; this is the current schedule.");
  const previous = { previousStartsAt: a.startsAt, previousEndsAt: a.endsAt };
  a.previousStartsAt = a.startsAt; a.previousEndsAt = a.endsAt; a.latestReasonCode = reason; a.latestMemberMessage = memberMessage;
  a.startsAt = newStart; a.endsAt = newEnd; a.rescheduleCount += 1; a.lastRescheduledAt = now; touch(a, now);
  return previous;
}

/** AuctionScheduleChange.ValidateReason */
export function validateRescheduleReason(code: RescheduleReason | null | undefined, reasonText: string | null | undefined, memberMessage: string | null | undefined) {
  requireRule(!!code && (RESCHEDULE_REASONS as readonly string[]).includes(code), "AUCTION_RESCHEDULE_REASON_REQUIRED", "Choose a valid reason for the schedule change.");
  const text = reasonText && reasonText.trim() ? reasonText.trim() : null;
  const message = memberMessage && memberMessage.trim() ? memberMessage.trim() : null;
  requireRule(code !== "Other" || (text !== null && text.length >= 5), "AUCTION_RESCHEDULE_REASON_REQUIRED", "Explain the reason in at least 5 characters when choosing Other.");
  requireRule(text === null || text.length <= 500, "AUCTION_RESCHEDULE_REASON_REQUIRED", "Keep the explanation within 500 characters.");
  requireRule(message === null || message.length <= 300, "AUCTION_RESCHEDULE_REASON_REQUIRED", "Keep the member message within 300 characters.");
  return { reasonText: text, memberMessage: message };
}

export function open(a: Auction, now: Date): void {
  requireRule(a.status === "Scheduled", "AUCTION_ALREADY_EXISTS", "This auction has already been opened or closed.");
  requireRule(now.getTime() >= a.startsAt.getTime() && now.getTime() < a.endsAt.getTime(), "AUCTION_OUTSIDE_WINDOW", "Open the auction within its configured time window.");
  a.status = "Open"; a.openedAt = now; touch(a, now);
}

export function ensureOpen(a: Auction): void {
  requireRule(a.status === "Open", a.status === "Closed" || a.status === "ClosedNoBids" || a.status === "WinnerSelected" ? "AUCTION_CLOSED" : "AUCTION_NOT_OPEN", "Auction is not open for bidding.");
}

// ---- Digital closing sequence --------------------------------------------------------------------------------

export type ClosingTransition =
  | { kind: "STARTED"; phase: "GOING_ONCE"; at: Date }
  | { kind: "ADVANCED"; from: ClosingPhase; phase: ClosingPhase; at: Date }
  | { kind: "RESET_BY_BID"; from: ClosingPhase; phase: "GOING_ONCE"; at: Date };

const phaseSeconds = (phase: ClosingPhase, c: AuctionConfig): number =>
  phase === "GOING_ONCE" ? c.goingOnceSeconds : phase === "GOING_TWICE" ? c.goingTwiceSeconds : phase === "FINAL_WARNING" ? c.finalWarningSeconds : 0;

const NEXT: Record<"GOING_ONCE" | "GOING_TWICE" | "FINAL_WARNING", ClosingPhase> = { GOING_ONCE: "GOING_TWICE", GOING_TWICE: "FINAL_WARNING", FINAL_WARNING: "FINALIZING" };

/** True when the scheduled window has ended with no bid: the auction closes with no winner (existing zero-bid behavior). */
export const endedWithoutBids = (a: Auction, now: Date): boolean => a.status === "Open" && a.closingPhase === null && a.lastBidSequence === 0 && now.getTime() >= a.endsAt.getTime();

/**
 * Materializes every closing transition that is due at `now`. Deterministic: GOING_ONCE begins exactly at EndsAt and
 * each phase deadline is anchored to the previous deadline, so the outcome depends only on bid timestamps and the
 * configured durations — never on when a worker happens to run. Each transition increments ClosingVersion.
 */
export function advanceClosing(a: Auction, now: Date, config: AuctionConfig): ClosingTransition[] {
  const transitions: ClosingTransition[] = [];
  if (a.status !== "Open") return transitions;
  if (a.closingPhase === null) {
    if (now.getTime() < a.endsAt.getTime() || a.lastBidSequence === 0) return transitions;
    a.closingPhase = "GOING_ONCE"; a.closingStartedAt = a.endsAt; a.closingPhaseEndsAt = addSeconds(a.endsAt, config.goingOnceSeconds); a.closingVersion += 1;
    transitions.push({ kind: "STARTED", phase: "GOING_ONCE", at: a.endsAt });
  }
  while (a.closingPhase !== null && a.closingPhase !== "FINALIZING" && a.closingPhaseEndsAt !== null && now.getTime() >= a.closingPhaseEndsAt.getTime()) {
    const from: "GOING_ONCE" | "GOING_TWICE" | "FINAL_WARNING" = a.closingPhase;
    const next: ClosingPhase = NEXT[from];
    const at = a.closingPhaseEndsAt;
    a.closingPhase = next;
    a.closingPhaseEndsAt = next === "FINALIZING" ? null : addSeconds(at, phaseSeconds(next, config));
    a.closingVersion += 1;
    transitions.push({ kind: "ADVANCED", from, phase: next, at });
  }
  if (transitions.length > 0) a.updatedAt = now;
  return transitions;
}

/** Read-side projection: the phase a viewer should see now, without persisting anything. */
export function effectiveClosing(a: Auction, now: Date, config: AuctionConfig): { state: ClosingState | null; phaseEndsAt: Date | null; version: number } {
  if (a.status === "WinnerSelected" || a.status === "ClosedNoBids" || a.status === "Closed") return { state: "COMPLETED", phaseEndsAt: null, version: a.closingVersion };
  const copy: Auction = { ...a };
  advanceClosing(copy, now, config);
  return { state: copy.closingPhase, phaseEndsAt: copy.closingPhaseEndsAt, version: copy.closingVersion };
}

/**
 * Auction.Bid with the digital closing sequence. Before EndsAt: the server-authoritative window applies unchanged.
 * During GOING_ONCE / GOING_TWICE / FINAL_WARNING: a valid higher bid is accepted and the sequence returns to
 * GOING_ONCE with a fresh deadline. Once FINALIZING, bidding is closed.
 */
export function placeBid(a: Auction, bidId: string, membershipId: string, discount: Decimal, key: string, now: Date, config: AuctionConfig,
  memberPolicy?: GroupMemberPolicy): { bid: AuctionBid; transitions: ClosingTransition[] } {
  ensureOpen(a);
  const transitions = advanceClosing(a, now, config);
  requireRule(a.closingPhase !== "FINALIZING", "AUCTION_CLOSED", "Bidding has closed; the auction is being finalized.");
  requireRule(a.openedAt !== null && now.getTime() >= a.openedAt.getTime() && now.getTime() >= a.startsAt.getTime() &&
    (a.closingPhase === null ? now.getTime() < a.endsAt.getTime() : now.getTime() < (a.closingPhaseEndsAt as Date).getTime()),
    "AUCTION_OUTSIDE_WINDOW", "Bidding is outside the server-authoritative auction window.");
  calculate(a.groupValue, a.memberLimit, discount, a.feePolicy, memberPolicy);
  requireRule(discount.gte(a.minimumDiscount), "DISCOUNT_BELOW_MINIMUM", "Discount is below the configured minimum.");
  requireRule(discount.lte(a.maximumDiscount), "DISCOUNT_ABOVE_MAXIMUM", "Discount exceeds the configured maximum.");
  requireRule(a.lastBidSequence === 0 || discount.gte(a.currentHighestDiscount.plus(a.bidIncrement)), "BID_INCREMENT_NOT_MET", "Increase the current highest discount by at least the configured increment.");
  // PostgreSQL stores microseconds; JS Dates are already millisecond-truncated.
  const bid: AuctionBid = { id: bidId, auctionId: a.id, groupId: a.groupId, cycleId: a.cycleId, membershipId, discountAmount: discount, sequenceNumber: a.lastBidSequence + 1, idempotencyKey: key, submittedAt: now };
  a.lastBidSequence = bid.sequenceNumber; a.currentHighestDiscount = discount; a.currentWinningBidId = bid.id; a.currentWinningMembershipId = membershipId; touch(a, now);
  if (a.closingPhase !== null) {
    const from = a.closingPhase;
    a.closingPhase = "GOING_ONCE"; a.closingPhaseEndsAt = addSeconds(now, config.goingOnceSeconds); a.closingVersion += 1;
    transitions.push({ kind: "RESET_BY_BID", from, phase: "GOING_ONCE", at: now });
  }
  return { bid, transitions };
}

/** Auction.WinningBid: highest discount, earliest sequence on ties (ties are impossible with the increment rule). */
export const winningBid = (bids: AuctionBid[]): AuctionBid | null =>
  [...bids].sort((x, y) => y.discountAmount.comparedTo(x.discountAmount) || x.sequenceNumber - y.sequenceNumber)[0] ?? null;

/** Auction.Close */
export function close(a: Auction, winner: AuctionBid | null, now: Date): void {
  ensureOpen(a);
  requireRule(winner === null ? a.lastBidSequence === 0 : winner.auctionId === a.id && winner.id === a.currentWinningBidId && winner.discountAmount.eq(a.currentHighestDiscount),
    "AUCTION_HISTORY_INCONSISTENT", "The authoritative bid history and current auction state do not agree.");
  a.closedAt = now;
  if (winner === null) a.status = "ClosedNoBids";
  else { a.status = "WinnerSelected"; a.winnerSelectedAt = now; }
  touch(a, now);
}

export interface AuctionResult {
  id: string; auctionId: string; groupId: string; cycleId: string; selectionResultId: string; winningBidId: string; winnerMembershipId: string; groupValue: Decimal;
  memberLimit: number; winningDiscount: Decimal; winnerPayout: Decimal; grossMemberShare: Decimal; platformFee: Decimal; memberBenefitPool: Decimal; feePolicy: AuctionFeePolicy;
  calculationVersion: string; finalizedAt: Date; finalizedByUserId: string;
  allocations: Array<{ id: string; membershipId: string | null; allocationType: "MemberBenefit" | "PlatformFee"; amount: Decimal; createdAt: Date }>;
}

/** AuctionResult.Create — every original member position (including earlier payout recipients) shares the discount. */
export function createResult(id: string, a: Auction, winner: AuctionBid, selectionResultId: string, memberIds: string[], actor: string, now: Date, newId: () => string,
  memberPolicy?: GroupMemberPolicy): AuctionResult {
  requireRule(winner.auctionId === a.id && memberIds.length === a.memberLimit && new Set(memberIds).size === a.memberLimit && memberIds.includes(winner.membershipId),
    "INVALID_AUCTION_RECIPIENTS", "Every original member position, including prior payout recipients, must be represented.");
  const c = calculate(a.groupValue, a.memberLimit, winner.discountAmount, a.feePolicy, memberPolicy);
  const allocations: AuctionResult["allocations"] = memberIds.filter((m) => m !== winner.membershipId)
    .map((m) => ({ id: newId(), membershipId: m, allocationType: "MemberBenefit" as const, amount: c.grossMemberShare, createdAt: now }));
  allocations.push({ id: newId(), membershipId: null, allocationType: "PlatformFee", amount: c.platformFee, createdAt: now });
  requireRule(allocations.reduce((s, x) => s.plus(x.amount), new Decimal(0)).eq(winner.discountAmount), "INVALID_AUCTION_ALLOCATION_PRECISION", "Allocations must conserve the winning discount.");
  return { id, auctionId: a.id, groupId: a.groupId, cycleId: a.cycleId, selectionResultId, winningBidId: winner.id, winnerMembershipId: winner.membershipId, groupValue: a.groupValue,
    memberLimit: a.memberLimit, winningDiscount: winner.discountAmount, winnerPayout: c.winnerPayout, grossMemberShare: c.grossMemberShare, platformFee: c.platformFee,
    memberBenefitPool: c.memberBenefitPool, feePolicy: a.feePolicy, calculationVersion: CALCULATION_VERSION, finalizedAt: now, finalizedByUserId: actor, allocations };
}
