import { compareDateOnly, type DateOnly } from "../../utils/dates.js";
import { requireRule } from "../../utils/errors.js";
import { Decimal, isPaise, MAX_AMOUNT } from "../../utils/money.js";

export const CONTRIBUTION_STATUSES = ["Pending", "Partial", "Recorded", "Overdue", "Reversed"] as const;
export const ENTRY_TYPES = ["Record", "Reversal"] as const;
export const FINANCIAL_STATUSES = ["Unpaid", "Settled", "Refunded"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];
export type ContributionEntryType = (typeof ENTRY_TYPES)[number];
export type ContributionFinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/**
 * A member's obligation for one cycle. RecordedAmount is operational tracking (manual groups);
 * FinanciallySettledAmount is captured money (Razorpay groups). They are deliberately separate:
 * a manual record is not a payment and never creates a ledger journal.
 */
export interface Contribution {
  id: string;
  groupId: string;
  cycleId: string;
  membershipId: string;
  expectedAmount: Decimal;
  recordedAmount: Decimal;
  financiallySettledAmount: Decimal;
  financialStatus: ContributionFinancialStatus;
  settledPaymentId: string | null;
  status: ContributionStatus;
  dueDate: DateOnly;
  recordedAt: Date | null;
  overdueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Operational history only. These entries do not represent money movement or accounting. */
export interface ContributionEntry {
  id: string;
  contributionId: string;
  entryType: ContributionEntryType;
  amount: Decimal;
  reference: string;
  idempotencyKey: string;
  recordedByUserId: string;
  note: string | null;
  createdAt: Date;
  reversesEntryId: string | null;
}

const validAmount = (amount: Decimal) => requireRule(amount.gt(0) && amount.lte(MAX_AMOUNT) && isPaise(amount), "INVALID_CONTRIBUTION_AMOUNT", "Amount must be positive with at most two decimal places.");
const validateText = (value: string | null | undefined, limit: number, code: string) =>
  requireRule(!!value && value.trim().length > 0 && value.length <= limit, code, `A value of at most ${limit} characters is required.`);
const touch = (c: Contribution, now: Date) => { c.updatedAt = now; c.version += 1; };

export function expectContribution(id: string, groupId: string, cycleId: string, membershipId: string, amount: Decimal, dueDate: DateOnly, now: Date): Contribution {
  validAmount(amount);
  return { id, groupId, cycleId, membershipId, expectedAmount: amount, recordedAmount: new Decimal(0), financiallySettledAmount: new Decimal(0), financialStatus: "Unpaid",
    settledPaymentId: null, status: "Pending", dueDate, recordedAt: null, overdueAt: null, createdAt: now, updatedAt: now, version: 0 };
}

export function markOverdue(c: Contribution, today: DateOnly, now: Date): boolean {
  if (compareDateOnly(today, c.dueDate) <= 0 || c.recordedAmount.eq(c.expectedAmount) || c.status === "Overdue") return false;
  c.status = "Overdue"; c.overdueAt ??= now; touch(c, now);
  return true;
}

function updateStatus(c: Contribution, today: DateOnly, now: Date, reversed: boolean): void {
  c.status = c.recordedAmount.eq(c.expectedAmount) ? "Recorded" : c.recordedAmount.gt(0) ? "Partial" : reversed ? "Reversed" : "Pending";
  touch(c, now);
  markOverdue(c, today, now);
}

export function recordContribution(c: Contribution, entryId: string, amount: Decimal, reference: string, note: string | null | undefined, key: string,
  actor: string, today: DateOnly, now: Date): ContributionEntry {
  validAmount(amount); validateText(reference, 200, "REFERENCE_REQUIRED"); validateText(key, 200, "IDEMPOTENCY_KEY_REQUIRED");
  requireRule(note === null || note === undefined || note.length <= 1000, "INVALID_NOTE", "Note must be at most 1000 characters.");
  requireRule(amount.lte(c.expectedAmount.minus(c.recordedAmount)), "CONTRIBUTION_OVER_RECORD", "Amount exceeds the remaining expected contribution.");
  c.recordedAmount = c.recordedAmount.plus(amount); c.recordedAt = now;
  updateStatus(c, today, now, false);
  return { id: entryId, contributionId: c.id, entryType: "Record", amount, reference: reference.trim(), note: note?.trim() ?? null, idempotencyKey: key,
    recordedByUserId: actor, createdAt: now, reversesEntryId: null };
}

export function reverseContribution(c: Contribution, entryId: string, original: ContributionEntry, reason: string, key: string, actor: string,
  alreadyReversed: boolean, today: DateOnly, now: Date): ContributionEntry {
  validateText(reason, 1000, "REASON_REQUIRED"); validateText(key, 200, "IDEMPOTENCY_KEY_REQUIRED");
  requireRule(original.contributionId === c.id && original.entryType === "Record", "INVALID_REVERSAL_TARGET", "Select an original record for this contribution.");
  requireRule(!alreadyReversed, "ENTRY_ALREADY_REVERSED", "This record has already been reversed.");
  requireRule(original.amount.lte(c.recordedAmount), "INVALID_REVERSAL_AMOUNT", "Reversal would make the contribution negative.");
  c.recordedAmount = c.recordedAmount.minus(original.amount);
  updateStatus(c, today, now, true);
  return { id: entryId, contributionId: original.contributionId, entryType: "Reversal", amount: original.amount, reference: original.reference, note: reason.trim(),
    idempotencyKey: key, recordedByUserId: actor, createdAt: now, reversesEntryId: original.id };
}

/** Contribution.Settle — only the exact outstanding financial obligation can settle, once. */
export function settle(c: Contribution, paymentId: string, amount: Decimal, now: Date): void {
  requireRule(!!paymentId && c.financiallySettledAmount.isZero() && amount.eq(c.expectedAmount), "CONTRIBUTION_ALREADY_SETTLED", "Only the exact outstanding financial obligation can settle.");
  c.financiallySettledAmount = amount; c.settledPaymentId = paymentId; c.financialStatus = "Settled"; touch(c, now);
}

/** Contribution.Refund — must reverse the current settlement. */
export function refund(c: Contribution, paymentId: string, now: Date): void {
  requireRule(c.settledPaymentId === paymentId && c.financiallySettledAmount.eq(c.expectedAmount), "INVALID_SETTLEMENT_REVERSAL", "Refund must reverse the current settlement.");
  c.financiallySettledAmount = new Decimal(0); c.settledPaymentId = null; c.financialStatus = "Refunded"; touch(c, now);
}
