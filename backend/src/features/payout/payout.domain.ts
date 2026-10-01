import { requireRule } from "../../utils/errors.js";
import { type Decimal, isPaise, MAX_AMOUNT } from "../../utils/money.js";

export const PAYOUT_TYPES = ["WinnerPayout", "MemberAuctionBenefit", "PlatformFeeSettlement"] as const;
export type PayoutType = (typeof PAYOUT_TYPES)[number];
export const PAYOUT_STATUSES = ["PendingBeneficiary", "ApprovalRequired", "Approved", "Processing", "ProviderPending", "Succeeded", "Failed", "ReconciliationRequired", "Cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const GATEWAY_PAYOUT_STATUSES = ["Pending", "Success", "Failed"] as const;
export type GatewayPayoutStatus = (typeof GATEWAY_PAYOUT_STATUSES)[number];

export const validatePayoutAmount = (amount: Decimal) =>
  requireRule(amount.gt(0) && amount.lte(MAX_AMOUNT) && isPaise(amount), "PAYOUT_AMOUNT_MISMATCH", "Payout must be a positive exact currency amount.");

/** Append-only beneficiary versions. Raw account numbers never reach the database; only "****1234". */
export interface Beneficiary {
  id: string; userId: string; provider: "FAKE"; providerFundAccountId: string; accountType: "BANK_ACCOUNT"; maskedAccountNumber: string; accountHolderName: string;
  bankName: string; ifsc: string; status: "FormatValidated" | "ProviderVerified"; createdAt: Date; availableAt: Date;
}

export function validateBeneficiaryInput(holder: string, account: string, confirmation: string, ifsc: string, bank: string | null | undefined): void {
  requireRule(!!holder?.trim() && holder.length <= 100 && (bank?.length ?? 0) <= 100 && typeof account === "string" && /^[0-9]{9,18}$/.test(account) && account === confirmation &&
    typeof ifsc === "string" && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc), "INVALID_PAYOUT_ACCOUNT", "Supply a holder name, matching 9–18 digit account numbers, and a valid IFSC format.");
}

/** A changed account becomes usable only after a 24-hour hold. */
export function createBeneficiary(id: string, user: string, token: string, holder: string, lastFour: string, ifsc: string, bank: string, now: Date, changed: boolean): Beneficiary {
  requireRule(!!user && token.startsWith("fake_fa_") && /^[0-9]{4}$/.test(lastFour), "INVALID_PAYOUT_ACCOUNT", "A fake provider reference and masked destination are required.");
  return { id, userId: user, provider: "FAKE", providerFundAccountId: token, accountType: "BANK_ACCOUNT", maskedAccountNumber: `****${lastFour}`, accountHolderName: holder.trim(),
    bankName: bank.trim(), ifsc, status: "FormatValidated", createdAt: now, availableAt: changed ? new Date(now.getTime() + 24 * 3_600_000) : now };
}

export interface PayoutObligation {
  id: string; groupId: string; groupName: string; cycleId: string; cycleNumber: number; membershipId: string | null; userId: string | null; memberName: string;
  selectionResultId: string; auctionResultId: string | null; sourceId: string; payoutType: PayoutType; amount: Decimal; currency: string; timeZone: string; status: PayoutStatus;
  beneficiaryId: string | null; approvedByUserId: string | null; approvedAt: Date | null; allocationJournalId: string; settlementJournalId: string | null;
  createdAt: Date; updatedAt: Date; settledAt: Date | null; version: number;
}

const touch = (p: PayoutObligation, now: Date) => { p.updatedAt = now; p.version += 1; };

export function createObligation(args: Omit<PayoutObligation, "currency" | "status" | "beneficiaryId" | "approvedByUserId" | "approvedAt" | "settlementJournalId" | "updatedAt" | "settledAt" | "version">): PayoutObligation {
  validatePayoutAmount(args.amount);
  requireRule(!!args.groupId && !!args.cycleId && !!args.selectionResultId && !!args.sourceId && !!args.allocationJournalId &&
    (args.payoutType === "PlatformFeeSettlement" ? args.membershipId === null && args.userId === null : args.membershipId !== null && args.userId !== null),
    "INVALID_PAYOUT_SOURCE", "A finalized source, recipient and funded allocation journal are required.");
  return { ...args, currency: "INR", status: "PendingBeneficiary", beneficiaryId: null, approvedByUserId: null, approvedAt: null, settlementJournalId: null,
    updatedAt: args.createdAt, settledAt: null, version: 0 };
}

export function approve(p: PayoutObligation, b: Beneficiary, actor: string, now: Date): void {
  requireRule(p.status === "PendingBeneficiary" || p.status === "ApprovalRequired", "PAYOUT_NOT_READY", "Only an unapproved payout can be approved.");
  requireRule(actor !== p.userId, "PAYOUT_SELF_APPROVAL_NOT_ALLOWED", "Recipients cannot approve their own payout.");
  requireRule(b.userId === p.userId && b.availableAt.getTime() <= now.getTime(), "PAYOUT_BENEFICIARY_REQUIRED", "An eligible recipient beneficiary is required; account changes have a 24-hour hold.");
  p.beneficiaryId = b.id; p.approvedByUserId = actor; p.approvedAt = now; p.status = "Approved"; touch(p, now);
}

export function begin(p: PayoutObligation, retry: boolean, now: Date): void {
  requireRule(p.beneficiaryId !== null, "PAYOUT_BENEFICIARY_REQUIRED", "Approve a beneficiary first.");
  requireRule(p.approvedAt !== null, "PAYOUT_NOT_APPROVED", "Approval is required.");
  requireRule(retry ? p.status === "Failed" : p.status === "Approved", retry ? "PAYOUT_NOT_RETRYABLE" : "PAYOUT_NOT_APPROVED", "Payout is not eligible for this execution.");
  p.status = "Processing"; touch(p, now);
}

export function observePayout(p: PayoutObligation, status: "ProviderPending" | "Failed" | "ReconciliationRequired", now: Date): void {
  if (p.status === "Succeeded" || p.status === "ReconciliationRequired") return;
  p.status = status; touch(p, now);
}

export function settlePayout(p: PayoutObligation, journal: string, now: Date): void {
  requireRule(p.status === "Processing" || p.status === "ProviderPending", "PAYOUT_RECONCILIATION_REQUIRED", "A matched active attempt is required.");
  p.settlementJournalId = journal; p.status = "Succeeded"; p.settledAt = now; touch(p, now);
}

export function settleInternalFee(p: PayoutObligation, now: Date): void {
  requireRule(p.payoutType === "PlatformFeeSettlement" && p.status === "PendingBeneficiary", "PAYOUT_NOT_READY", "Only the internally allocated fee can settle without a provider.");
  p.settlementJournalId = p.allocationJournalId; p.status = "Succeeded"; p.settledAt = now; touch(p, now);
}

export interface PayoutAttempt {
  id: string; payoutObligationId: string; attemptNumber: number; provider: "FAKE"; providerPayoutId: string; idempotencyKey: string; requestKey: string; beneficiaryId: string;
  providerFundAccountId: string; maskedAccountNumber: string; amount: Decimal; currency: string; requestedAt: Date; createdByUserId: string;
}

/** Immutable execution intent; provider outcomes live in append-only observation rows. */
export function createAttempt(id: string, p: PayoutObligation, b: Beneficiary, number: number, key: string, actor: string, now: Date): PayoutAttempt {
  requireRule(p.status === "Processing" && p.beneficiaryId === b.id && number > 0 && !!key.trim() && key.length <= 200, "PAYOUT_NOT_READY", "Execution requires the approved destination and an idempotency key.");
  const n = id.replace(/-/g, "");
  return { id, payoutObligationId: p.id, attemptNumber: number, provider: "FAKE", providerPayoutId: `fake_po_${n}`, idempotencyKey: `dhp_${n}`, requestKey: key, beneficiaryId: b.id,
    providerFundAccountId: b.providerFundAccountId, maskedAccountNumber: b.maskedAccountNumber, amount: p.amount, currency: "INR", requestedAt: now, createdByUserId: actor };
}
