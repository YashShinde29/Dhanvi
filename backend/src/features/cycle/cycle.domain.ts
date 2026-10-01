import { addMonths, compareDateOnly, type DateOnly, makeDateOnly, parseDateOnly } from "../../utils/dates.js";
import { requireRule } from "../../utils/errors.js";
import { Decimal, isPaise } from "../../utils/money.js";
import { firstCycleSelectionMethod } from "../group/group.domain.js";
import type { CollectionMode, Group, SelectionMethod } from "../group/group.types.js";

export const CYCLE_STATUSES = ["Upcoming", "CollectingContributions", "ContributionsComplete", "ReadyForSelection", "SelectionCompleted", "PayoutPending", "PayoutCompleted", "Completed", "Suspended"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export interface MonthlyCycle {
  id: string;
  groupId: string;
  cycleNumber: number;
  selectionMethod: SelectionMethod;
  contributionDueDate: DateOnly;
  selectionDate: DateOnly;
  payoutDate: DateOnly;
  expectedMemberCount: number;
  expectedContributionPerMember: Decimal;
  expectedPoolAmount: Decimal;
  recordedContributionAmount: Decimal;
  fullyRecordedMemberCount: number;
  financiallySettledAmount: Decimal;
  financiallySettledMemberCount: number;
  collectionMode: CollectionMode;
  status: CycleStatus;
  startedAt: Date | null;
  contributionsCompletedAt: Date | null;
  readyForSelectionAt: Date | null;
  selectionCompletedAt: Date | null;
  selectionResultId: string | null;
  payoutCompletedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** MonthlyCycle.Create */
export function createCycle(id: string, groupId: string, number: number, method: SelectionMethod, dueDate: DateOnly, selectionDate: DateOnly, payoutDate: DateOnly,
  members: number, contribution: Decimal, pool: Decimal, now: Date): MonthlyCycle {
  requireRule(number >= 1 && members > 0 && number <= members && contribution.gt(0) && isPaise(contribution) && contribution.times(members).eq(pool),
    "INVALID_EXPECTED_POOL", "Expected contribution times member count must exactly equal group value.");
  requireRule(compareDateOnly(dueDate, selectionDate) <= 0 && compareDateOnly(selectionDate, payoutDate) <= 0, "INVALID_CYCLE_DATES", "Cycle dates must follow contribution, selection, payout order.");
  return {
    id, groupId, cycleNumber: number, selectionMethod: method, contributionDueDate: dueDate, selectionDate, payoutDate, expectedMemberCount: members,
    expectedContributionPerMember: contribution, expectedPoolAmount: pool, recordedContributionAmount: new Decimal(0), fullyRecordedMemberCount: 0,
    financiallySettledAmount: new Decimal(0), financiallySettledMemberCount: 0, collectionMode: "ManualTracking",
    status: number === 1 ? "CollectingContributions" : "Upcoming", startedAt: number === 1 ? now : null, contributionsCompletedAt: null, readyForSelectionAt: null,
    selectionCompletedAt: null, selectionResultId: null, payoutCompletedAt: null, completedAt: null, createdAt: now, updatedAt: now, version: 0,
  };
}

const touch = (c: MonthlyCycle, now: Date) => { c.updatedAt = now; c.version += 1; };

const contributionsComplete = (c: MonthlyCycle, recorded: Decimal, fullyRecorded: number) =>
  c.collectionMode === "Razorpay"
    ? c.financiallySettledMemberCount === c.expectedMemberCount && c.financiallySettledAmount.eq(c.expectedPoolAmount)
    : fullyRecorded === c.expectedMemberCount && recorded.eq(c.expectedPoolAmount);

export function completeSettlement(c: MonthlyCycle, now: Date): void {
  requireRule(c.status === "SelectionCompleted", "CYCLE_SETTLEMENT_INCOMPLETE", "Only a selected cycle can complete settlement.");
  c.payoutCompletedAt = now; c.status = "Completed"; c.completedAt = now; touch(c, now);
}

export function openNext(c: MonthlyCycle, now: Date): void {
  requireRule(c.status === "Upcoming", "NEXT_CYCLE_NOT_ALLOWED", "Only an upcoming cycle may open.");
  c.status = "CollectingContributions"; c.startedAt = now; touch(c, now);
}

export function completeSelection(c: MonthlyCycle, resultId: string, now: Date): void {
  requireRule(c.status === "ReadyForSelection" && c.selectionResultId === null && !!resultId, "CYCLE_NOT_READY_FOR_SELECTION", "Only a ready cycle with no existing result can complete selection.");
  requireRule(contributionsComplete(c, c.recordedContributionAmount, c.fullyRecordedMemberCount), "CYCLE_NOT_READY_FOR_SELECTION", "Contribution totals must still be complete.");
  c.selectionResultId = resultId; c.selectionCompletedAt = now; c.status = "SelectionCompleted"; touch(c, now);
}

export const ensureRecordingOpen = (c: MonthlyCycle) =>
  requireRule(c.status === "CollectingContributions", "CYCLE_NOT_COLLECTING", "Only the collecting cycle accepts new contribution records.");

export const ensureReversalAllowed = (c: MonthlyCycle) =>
  requireRule(c.status === "CollectingContributions" || c.status === "ContributionsComplete" || c.status === "ReadyForSelection",
    "CYCLE_REVERSAL_NOT_ALLOWED", "Reversal is allowed only before selection execution.");

/**
 * MonthlyCycle.Recalculate — the caller supplies totals over every obligation while holding the group lock.
 * Returns true when the cycle just became ready for selection. A shortfall reopens the same cycle.
 */
export function recalculate(c: MonthlyCycle, recorded: Decimal, fullyRecorded: number, obligationCount: number, now: Date): boolean {
  ensureReversalAllowed(c);
  requireRule(obligationCount === c.expectedMemberCount && recorded.gte(0) && recorded.lte(c.expectedPoolAmount) && fullyRecorded >= 0 && fullyRecorded <= c.expectedMemberCount,
    "INVALID_CYCLE_TOTALS", "Cycle totals do not match its expected obligations.");
  c.recordedContributionAmount = recorded; c.fullyRecordedMemberCount = fullyRecorded; touch(c, now);
  const complete = contributionsComplete(c, recorded, fullyRecorded);
  const becameReady = complete && c.status !== "ReadyForSelection";
  if (complete) {
    if (becameReady) { c.contributionsCompletedAt = now; c.status = "ReadyForSelection"; c.readyForSelectionAt = now; }
  } else {
    // A reversal reopens this same cycle. Historical readiness events remain in audit history.
    c.status = "CollectingContributions"; c.contributionsCompletedAt = null; c.readyForSelectionAt = null;
  }
  return becameReady;
}

/** MonthlyCycle.RecalculateFinancial (Razorpay collection) */
export function recalculateFinancial(c: MonthlyCycle, amount: Decimal, members: number, count: number, now: Date): boolean {
  requireRule(c.collectionMode === "Razorpay" && amount.gte(0) && amount.lte(c.expectedPoolAmount) && members >= 0 && members <= c.expectedMemberCount,
    "INVALID_FINANCIAL_TOTALS", "Financial totals must match cycle obligations.");
  c.financiallySettledAmount = amount; c.financiallySettledMemberCount = members;
  return recalculate(c, c.recordedContributionAmount, c.fullyRecordedMemberCount, count, now);
}

/**
 * CycleSchedule.Generate — one monthly cycle per member. The first due date is on/after the start date (next month
 * when this month's due day has passed); selection and payout days fall in the due month.
 */
export function generateSchedule(group: Group, now: Date, newId: () => string): MonthlyCycle[] {
  const r = group.rules;
  requireRule(group.durationMonths === group.memberLimit && group.monthlyContribution.times(group.memberLimit).eq(group.groupValue), "INVALID_EXPECTED_POOL", "Group duration and expected pool are inconsistent.");
  const start = parseDateOnly(r.startDate);
  requireRule(start !== null && r.contributionDueDay >= 1 && r.contributionDueDay <= r.selectionDay && r.selectionDay <= r.payoutDay && r.payoutDay <= 28 && start.year <= 9995,
    "INVALID_CYCLE_DATES", "Scheduling days must be ordered between 1 and 28 and the full schedule must fit the calendar.");
  let first = makeDateOnly(start.year, start.month, r.contributionDueDay);
  if (compareDateOnly(first, r.startDate) < 0) first = addMonths(first, 1);
  const cycles: MonthlyCycle[] = [];
  for (let number = 1; number <= group.durationMonths; number++) {
    const due = addMonths(first, number - 1);
    const d = parseDateOnly(due)!;
    const method: SelectionMethod = number === 1 ? firstCycleSelectionMethod(r) : r.groupType === "Random" ? "Random" : "Auction";
    cycles.push(createCycle(newId(), group.id, number, method, due, makeDateOnly(d.year, d.month, r.selectionDay), makeDateOnly(d.year, d.month, r.payoutDay),
      group.memberLimit, group.monthlyContribution, group.groupValue, now));
  }
  for (const c of cycles) c.collectionMode = r.collectionMode;
  return cycles;
}
