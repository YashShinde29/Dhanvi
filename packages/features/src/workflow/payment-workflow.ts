import type { Contribution, Payment, PaymentEligibility } from "@dhanvi/types";
import { formatDate, formatMoney, statusGuidance } from "@dhanvi/utils";
import type { WorkflowAction, WorkflowStep, WorkflowSummary } from "./workflow-status";

/** Checkout status message from the eligibility snapshot the backend returns (never from frontend callback state). */
export function paymentGuidance(e: PaymentEligibility, lastPayment?: Payment | null): { title: string; description: string; status: WorkflowSummary["status"]; next?: string; retry?: boolean } {
  const financial = e.financialStatus.toUpperCase();
  if (financial === "SETTLED" || (e.financiallySettledAmount > 0 && e.remainingAmount === 0)) return { title: "Payment confirmed ✓", description: "Your contribution for this cycle is complete.", status: "complete", next: "Waiting for other group members." };
  if (financial === "REFUNDED" && !e.paymentId) return { title: "Payment refunded", description: "The earlier payment was refunded, so this contribution is open again.", status: "attention", next: "Pay the contribution again.", retry: true };
  if (lastPayment?.status === "FAILED" || (e.paymentId && e.canPay && lastPayment?.status === "FAILED")) return { title: "Payment failed", description: "Your contribution has not been settled. You were not charged.", status: "attention", next: "Try the payment again.", retry: true };
  if (lastPayment?.status === "RECONCILIATION_REQUIRED") return { title: "Payment under review", description: "Dhanvi is reconciling this payment with Razorpay. Do not pay again.", status: "blocked", next: "Dhanvi resolves the review; no action is required from you." };
  if (e.paymentId && !e.canPay) return { title: "Payment submitted", description: "We're verifying the payment with Razorpay.", status: "waiting", next: "No additional payment is required while verification is in progress." };
  if (e.canPay) return { title: "Payment pending", description: `${formatMoney(e.remainingAmount)} due for this cycle.`, status: "attention", next: "Pay the contribution." };
  return { title: "Not payable right now", description: e.reason ?? "This contribution cannot be paid through the gateway at the moment.", status: "upcoming" };
}

/** Steps for a payment record: order → checkout → verification → confirmed. */
export function paymentSteps(p: Payment): WorkflowStep[] {
  const rank = p.status === "PENDING" ? (p.providerOrderId ? 1 : 0) : p.status === "AUTHORIZED" ? 2 : p.status === "CAPTURED" ? 4 : p.status === "FAILED" ? 1 : p.status === "REFUNDED" || p.status === "REFUND_PENDING" ? 4 : p.status === "RECONCILIATION_REQUIRED" ? 2 : 0;
  const s = (i: number, cur: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (i < rank ? "complete" : i === rank ? cur : "upcoming");
  return [
    { id: "order", label: "Order created", state: s(0) },
    { id: "checkout", label: "Checkout", state: p.status === "FAILED" ? "blocked" : s(1), hint: p.status === "FAILED" ? "Attempt failed" : undefined },
    { id: "verify", label: "Verification", state: p.status === "RECONCILIATION_REQUIRED" ? "blocked" : s(2, "waiting"), hint: p.status === "RECONCILIATION_REQUIRED" ? "Needs reconciliation" : undefined },
    { id: "captured", label: "Payment confirmed", state: rank >= 4 ? "complete" : "upcoming", hint: p.refundedAt ? "Later refunded" : undefined },
  ];
}

export function paymentSummary(p: Payment, viewer: "member" | "admin"): WorkflowSummary {
  const g = statusGuidance("payment", p.status);
  const steps = paymentSteps(p);
  const base: WorkflowSummary = { stage: g.stage, status: "current", headline: g.description, steps, responsibleRole: g.nextActor === "NONE" ? undefined : g.nextActor };
  switch (p.status) {
    case "CAPTURED": return { ...base, status: "complete", headline: `Contribution for cycle ${p.cycleNumber} settled${p.settledAt ? ` on ${formatDate(p.settledAt)}` : ""}.`, next: "Waiting for other group members." };
    case "PENDING": return { ...base, status: p.reconciliationStatus === "MATCHED" ? "waiting" : "current", headline: p.providerOrderId ? "Razorpay order created · awaiting a verified payment." : "Order intent recorded.", waitingFor: "a verified capture from Razorpay", next: viewer === "member" ? "Complete Checkout, or check the gateway status if you already paid." : "Reconcile to fetch provider state." };
    case "AUTHORIZED": return { ...base, status: "waiting", waitingFor: "capture confirmation from Razorpay" };
    case "FAILED": return { ...base, status: "attention", next: "Try the payment again from your contributions page." };
    case "REFUND_PENDING": return { ...base, status: "waiting", waitingFor: "Razorpay to confirm the refund" };
    case "REFUNDED": return { ...base, status: "complete", headline: `Refunded${p.refundedAt ? ` on ${formatDate(p.refundedAt)}` : ""}. The contribution is open again.`, next: viewer === "member" ? "Pay the contribution again when ready." : undefined };
    case "RECONCILIATION_REQUIRED": return { ...base, status: "blocked", blockedBy: p.reconciliationMessage ?? "Provider data did not match.", responsibleRole: "FINANCE", next: "Nothing changes until an administrator reviews the mismatch." };
    default: return base;
  }
}

/** Dashboard item for an outstanding contribution. */
export function contributionAction(c: Contribution): WorkflowAction {
  const financial = c.collectionMode === "RAZORPAY";
  const due = c.expectedAmount - (financial ? c.financiallySettledAmount : c.recordedAmount);
  const overdue = c.status === "OVERDUE";
  return financial
    ? { id: `due-${c.id}`, title: `Pay cycle ${c.cycleNumber} contribution · ${c.groupName}`, description: `${overdue ? "Overdue since" : "Due"} ${formatDate(c.dueDate)}.`, amount: due, status: overdue ? "blocked" : "attention", responsibleRole: "USER", actionLabel: "Pay now", actionHref: `/contributions?groupId=${c.groupId}`, priority: overdue ? 0 : 5 }
    : { id: `due-${c.id}`, title: `Cycle ${c.cycleNumber} contribution due · ${c.groupName}`, description: `${overdue ? "Overdue since" : "Due"} ${formatDate(c.dueDate)} · pay your organizer, who records it.`, amount: due, status: overdue ? "blocked" : "current", responsibleRole: "USER", actionLabel: "View contribution", actionHref: `/contributions?groupId=${c.groupId}`, priority: overdue ? 1 : 20 };
}

/** Admin payments triage buckets from the list summary. */
export function paymentPriority(summary: { captured: number; pending: number; failed: number; reconciliationRequired: number }) {
  return [
    { id: "RECONCILIATION_REQUIRED", label: "Action required", count: summary.reconciliationRequired, tone: "danger" as const, hint: "Reconciliation required" },
    { id: "PENDING", label: "Waiting for provider", count: summary.pending, tone: "info" as const, hint: "Awaiting verified capture" },
    { id: "CAPTURED", label: "Completed", count: summary.captured, tone: "success" as const, hint: "Captured and settled" },
    { id: "FAILED", label: "Failed", count: summary.failed, tone: "warning" as const, hint: "Member can retry" },
  ];
}
