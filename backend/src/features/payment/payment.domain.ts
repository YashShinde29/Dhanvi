import { requireRule } from "../../utils/errors.js";
import type { Decimal } from "../../utils/money.js";
import { toMinorUnits } from "../../utils/money.js";

/** Persisted payment states — unchanged from the .NET enum (stored as EF names). */
export const PAYMENT_STATUSES = ["Created", "Pending", "Authorized", "Captured", "Failed", "Cancelled", "RefundPending", "Refunded", "ReconciliationRequired"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const RECONCILIATION_STATUSES = ["Pending", "Matched", "Mismatch", "Failed"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface Payment {
  id: string; contributionId: string; groupId: string; cycleId: string; membershipId: string; userId: string; groupName: string; memberName: string; cycleNumber: number;
  businessTimeZone: string; provider: string; environment: string; providerOrderId: string | null; providerPaymentId: string | null; amount: Decimal; currency: string;
  status: PaymentStatus; attemptNumber: number; idempotencyKey: string; receipt: string; createdAt: Date; updatedAt: Date; authorizedAt: Date | null; capturedAt: Date | null;
  failedAt: Date | null; refundedAt: Date | null; settledAt: Date | null; journalId: string | null; reversalJournalId: string | null; failureCode: string | null;
  failureReason: string | null; reconciliationStatus: ReconciliationStatus; lastReconciledAt: Date | null; reconciliationMessage: string | null; version: number;
}

const touch = (p: Payment, now: Date) => { p.updatedAt = now; p.version += 1; };

export function createPayment(id: string, s: { contributionId: string; groupId: string; cycleId: string; membershipId: string; userId: string; groupName: string; memberName: string;
  cycleNumber: number; timeZone: string }, amount: Decimal, key: string, attempt: number, now: Date): Payment {
  toMinorUnits(amount);
  requireRule(!!key.trim() && key.length <= 200 && attempt > 0, "INVALID_PAYMENT", "A payment needs valid source references and idempotency key.");
  return {
    id, contributionId: s.contributionId, groupId: s.groupId, cycleId: s.cycleId, membershipId: s.membershipId, userId: s.userId, groupName: s.groupName, memberName: s.memberName,
    cycleNumber: s.cycleNumber, businessTimeZone: s.timeZone, provider: "RAZORPAY", environment: "TEST", providerOrderId: null, providerPaymentId: null, amount, currency: "INR",
    status: "Created", attemptNumber: attempt, idempotencyKey: key.trim(), receipt: `dh_${id.replace(/-/g, "")}`, createdAt: now, updatedAt: now, authorizedAt: null, capturedAt: null,
    failedAt: null, refundedAt: null, settledAt: null, journalId: null, reversalJournalId: null, failureCode: null, failureReason: null, reconciliationStatus: "Pending",
    lastReconciledAt: null, reconciliationMessage: null, version: 0,
  };
}

export function setOrder(p: Payment, order: string, now: Date): void {
  requireRule(!!order.trim() && order.length <= 100 && (p.providerOrderId === null || p.providerOrderId === order), "PAYMENT_ORDER_MISMATCH", "The provider order does not match this payment.");
  p.providerOrderId = order;
  if (p.status === "Created") p.status = "Pending";
  touch(p, now);
}

/** Payment.Observe — returns true when state changed. Captured, refunding and reconciliation holds are sticky. */
export function observe(p: Payment, paymentId: string, status: "Authorized" | "Captured" | "Failed", occurred: Date, now: Date): boolean {
  requireRule(!!paymentId.trim() && paymentId.length <= 100, "INVALID_PAYMENT_TRANSITION", "Unsupported payment observation.");
  if (p.status === "ReconciliationRequired") return false;
  if (p.capturedAt !== null || p.status === "RefundPending" || p.status === "Refunded") return false;
  if (status === "Failed") {
    if (p.status === "Authorized" || p.status === "Failed") return false;
    p.status = "Failed"; p.failedAt = occurred; p.failureCode = "GATEWAY_FAILED"; p.failureReason = "The gateway did not capture this attempt."; touch(p, now);
    return true;
  }
  requireRule(p.providerPaymentId === null || p.providerPaymentId === paymentId, "PAYMENT_ID_MISMATCH", "A different provider payment is already bound.");
  p.providerPaymentId = paymentId;
  if (p.status === status) return false;
  p.status = status;
  if (status === "Authorized") p.authorizedAt = occurred;
  if (status === "Captured") p.capturedAt = occurred;
  p.failureCode = null; p.failureReason = null; touch(p, now);
  return true;
}

export function settlePayment(p: Payment, journal: string, now: Date): void {
  requireRule(p.status === "Captured" && p.settledAt === null && !!journal, "INVALID_PAYMENT_SETTLEMENT", "Only an unsettled capture can settle.");
  p.journalId = journal; p.settledAt = now; touch(p, now);
}

export function refundPending(p: Payment, now: Date): void {
  if (p.status === "Refunded") return;
  requireRule(p.capturedAt !== null && p.settledAt !== null, "INVALID_REFUND", "A settled capture is required.");
  p.status = "RefundPending"; touch(p, now);
}

export function refundPayment(p: Payment, journal: string, now: Date): void {
  requireRule(p.settledAt !== null && p.refundedAt === null, "INVALID_REFUND", "Only a settled capture can be refunded.");
  p.status = "Refunded"; p.refundedAt = now; p.reversalJournalId = journal; touch(p, now);
}

export function refundFailed(p: Payment, now: Date): void {
  if (p.status !== "RefundPending") return;
  p.status = "Captured"; touch(p, now);
}

export function reconcile(p: Payment, result: ReconciliationStatus, message: string, now: Date): void {
  p.reconciliationStatus = result; p.reconciliationMessage = message; p.lastReconciledAt = now;
  if (result === "Mismatch") p.status = "ReconciliationRequired";
  touch(p, now);
}
