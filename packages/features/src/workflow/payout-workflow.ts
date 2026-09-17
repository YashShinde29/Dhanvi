import type { Payout, PayoutAccount } from "@dhanvi/types";
import { formatDate, formatMoney, statusGuidance } from "@dhanvi/utils";
import type { WorkflowAction, WorkflowStep, WorkflowSummary } from "./workflow-status";

const ACTIVE = ["PENDING_BENEFICIARY", "APPROVAL_REQUIRED", "APPROVED", "PROCESSING", "PROVIDER_PENDING", "FAILED", "RECONCILIATION_REQUIRED"];

/** Backend keeps unapproved payouts in PENDING_BENEFICIARY; the read model says whether approval can succeed now. */
export const approvable = (p: Payout) => p.status === "APPROVAL_REQUIRED" || (p.status === "PENDING_BENEFICIARY" && p.beneficiaryAvailable);
/** Presentation status: PENDING_BENEFICIARY with a usable account reads as "awaiting approval". */
export const effectiveStatus = (p: Payout) => (approvable(p) ? "APPROVAL_REQUIRED" : p.status);

export function payoutSteps(p: Payout): WorkflowStep[] {
  const rank: Record<string, number> = { PENDING_BENEFICIARY: 0, APPROVAL_REQUIRED: 1, APPROVED: 2, PROCESSING: 3, PROVIDER_PENDING: 3, SUCCEEDED: 4, FAILED: 3, RECONCILIATION_REQUIRED: 3, CANCELLED: -1 };
  const r = rank[effectiveStatus(p)] ?? 0;
  const s = (i: number, cur: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (i < r ? "complete" : i === r ? cur : "upcoming");
  return [
    { id: "account", label: "Bank account", state: s(0, "attention"), hint: p.maskedAccountNumber ? `Ending ${p.maskedAccountNumber.slice(-4)}` : r === 0 ? "Not added" : p.beneficiaryAvailable ? "Available" : undefined },
    { id: "approval", label: "Admin approval", state: s(1, "attention") },
    { id: "execute", label: "Execution", state: s(2, "attention") },
    { id: "provider", label: "Provider transfer", state: p.status === "FAILED" || p.status === "RECONCILIATION_REQUIRED" ? "blocked" : s(3, "waiting"), hint: p.status === "FAILED" ? "Failed" : p.status === "RECONCILIATION_REQUIRED" ? "Mismatch" : undefined },
    { id: "settled", label: "Payout completed", state: r >= 4 ? "complete" : "upcoming", hint: p.settledAt ? formatDate(p.settledAt) : undefined },
  ];
}

export function payoutSummary(payout: Payout, viewer: "member" | "organizer" | "admin", account?: PayoutAccount | null): WorkflowSummary {
  const p = { ...payout, status: effectiveStatus(payout) as Payout["status"] };
  const g = statusGuidance("payout", p.status);
  const steps = payoutSteps(p);
  const fee = p.payoutType === "PLATFORM_FEE_SETTLEMENT";
  const base: WorkflowSummary = { stage: g.stage, status: "current", headline: `${formatMoney(p.amount)} · ${g.description}`, steps, responsibleRole: g.nextActor === "NONE" ? undefined : g.nextActor, detail: p.maskedAccountNumber ? `Destination: bank account ending ${p.maskedAccountNumber.slice(-4)}` : fee ? "Destination: internal accounting allocation" : undefined };
  switch (p.status) {
    case "PENDING_BENEFICIARY":
      if (viewer === "member") return { ...base, status: account ? "waiting" : "attention", headline: account ? `${formatMoney(p.amount)} · your bank account is saved; approval follows once it becomes available.` : `${formatMoney(p.amount)} · add a bank account before this payout can be processed.`, waitingFor: account ? "Dhanvi approval" : undefined, action: account ? undefined : { title: "Add a payout bank account", description: "Required before your payout can be approved.", status: "attention", responsibleRole: "USER", actionLabel: "Add bank account", actionHref: "/payouts#payout-account" }, next: "Dhanvi approves the destination, then executes the transfer." };
      return { ...base, status: "waiting", waitingFor: "the recipient to add a payout bank account", blockedBy: viewer === "admin" ? "Approval is unavailable until the recipient adds a payout bank account." : undefined, responsibleRole: "USER" };
    case "APPROVAL_REQUIRED": return { ...base, status: viewer === "admin" ? "attention" : "waiting", waitingFor: viewer === "admin" ? undefined : "Dhanvi approval", next: "After approval the transfer is executed.", action: viewer === "admin" ? { title: "Approve the payout destination", status: "attention", responsibleRole: "FINANCE", actionLabel: "Review payout", actionHref: `/payouts/${p.id}` } : undefined };
    case "APPROVED": return { ...base, status: viewer === "admin" ? "attention" : "waiting", headline: `${formatMoney(p.amount)} approved${p.maskedAccountNumber ? ` · bank account ending ${p.maskedAccountNumber.slice(-4)}` : ""}.`, waitingFor: viewer === "admin" ? undefined : "Dhanvi to execute the transfer", next: "The provider processes the transfer; no action is required from the recipient." };
    case "PROCESSING": case "PROVIDER_PENDING": return { ...base, status: "waiting", headline: `${formatMoney(p.amount)} is processing.`, waitingFor: "the payout provider to confirm the transfer", next: "The payout shows as completed once the provider confirms." };
    case "SUCCEEDED": return { ...base, status: "complete", headline: `${formatMoney(p.amount)} paid${p.settledAt ? ` on ${formatDate(p.settledAt)}` : ""}.`, responsibleRole: undefined };
    case "FAILED": return { ...base, status: viewer === "admin" ? "attention" : "waiting", headline: `${formatMoney(p.amount)} · the transfer failed.`, waitingFor: viewer === "admin" ? undefined : "Dhanvi to retry the transfer", next: "Dhanvi retries the payout; no action is required from the recipient.", action: viewer === "admin" ? { title: "Retry the failed payout", status: "attention", responsibleRole: "FINANCE", actionLabel: "Open payout", actionHref: `/payouts/${p.id}` } : undefined };
    case "RECONCILIATION_REQUIRED": return { ...base, status: "blocked", blockedBy: "Provider data did not match Dhanvi's record. Settlement and retries stay blocked until reviewed.", responsibleRole: "FINANCE" };
    case "CANCELLED": return { ...base, status: "blocked", headline: `${formatMoney(p.amount)} · cancelled.`, responsibleRole: undefined };
    default: return base;
  }
}

/** Admin checklist for one payout: funding, beneficiary, approval, execution. */
export function payoutChecklist(p: Payout): { label: string; done: boolean; hint?: string }[] {
  const r = ["PENDING_BENEFICIARY", "APPROVAL_REQUIRED", "APPROVED", "PROCESSING", "PROVIDER_PENDING", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED"].indexOf(effectiveStatus(p));
  return [
    { label: "Funding verified", done: true, hint: "Prepared from a funded selection" },
    { label: "Beneficiary account", done: !!p.maskedAccountNumber || p.beneficiaryAvailable || p.payoutType === "PLATFORM_FEE_SETTLEMENT", hint: p.maskedAccountNumber ? `Ending ${p.maskedAccountNumber.slice(-4)}` : p.beneficiaryAvailable ? "Recipient's account is available" : "Recipient has not added a payout bank account (or it is in its 24-hour hold)" },
    { label: "Approval", done: r >= 2, hint: r === 1 ? "Pending your approval" : undefined },
    { label: "Execution", done: r >= 3 && p.status !== "FAILED", hint: p.status === "FAILED" ? "Last attempt failed" : undefined },
    { label: "Provider confirmation", done: p.status === "SUCCEEDED" },
  ];
}

/** Member dashboard items derived from real payout obligations. */
export function memberPayoutActions(payouts: Payout[], account: PayoutAccount | null | undefined): { actions: WorkflowAction[]; waiting: WorkflowAction[] } {
  const actions: WorkflowAction[] = [], waiting: WorkflowAction[] = [];
  for (const p of payouts.filter((x) => ACTIVE.includes(x.status)).map((x) => ({ ...x, status: effectiveStatus(x) as Payout["status"] }))) {
    const label = `${p.payoutType === "MEMBER_AUCTION_BENEFIT" ? "Auction benefit" : "Payout"} · ${p.groupName} · cycle ${p.cycleNumber}`;
    if (p.status === "PENDING_BENEFICIARY" && !account) actions.push({ id: `acct-${p.id}`, title: "Add payout bank account", description: `Required before your ${formatMoney(p.amount)} ${label.toLowerCase()} can be processed.`, amount: p.amount, status: "attention", responsibleRole: "USER", actionLabel: "Add bank account", actionHref: "/payouts#payout-account", priority: 8 });
    else waiting.push({ id: `wait-${p.id}`, title: `${statusGuidance("payout", p.status).stage} · ${label}`, description: statusGuidance("payout", p.status).description, amount: p.amount, status: p.status === "RECONCILIATION_REQUIRED" ? "blocked" : "waiting", responsibleRole: p.status === "PENDING_BENEFICIARY" ? "ADMIN" : statusGuidance("payout", p.status).nextActor === "SYSTEM" ? "SYSTEM" : "ADMIN", since: p.createdAt, actionLabel: "View payout", actionHref: `/payouts/${p.id}` });
  }
  return { actions, waiting };
}

/** Admin payouts triage from the list summary. */
/** Admin payouts triage from the operations read model (approval counts respect beneficiary availability). */
export function payoutPriority(counts: { approvalRequired: number; approved: number; failed: number; reconciliationRequired: number; pendingBeneficiary: number; processing: number; succeeded: number } | undefined) {
  const c = counts ?? { approvalRequired: 0, approved: 0, failed: 0, reconciliationRequired: 0, pendingBeneficiary: 0, processing: 0, succeeded: 0 };
  return [
    { id: "APPROVAL_REQUIRED", label: "To approve", count: c.approvalRequired, tone: "warning" as const, hint: "Beneficiary available" },
    { id: "APPROVED", label: "To execute", count: c.approved, tone: "warning" as const, hint: "Approved" },
    { id: "FAILED", label: "Failed", count: c.failed, tone: "danger" as const, hint: "Retry available" },
    { id: "RECONCILIATION_REQUIRED", label: "Reconciliation", count: c.reconciliationRequired, tone: "danger" as const, hint: "Provider mismatch" },
    { id: "PENDING_BENEFICIARY", label: "Waiting on member", count: c.pendingBeneficiary, tone: "info" as const, hint: "Bank account missing" },
    { id: "PROCESSING", label: "Waiting for provider", count: c.processing, tone: "info" as const, hint: "Transfer in progress" },
    { id: "SUCCEEDED", label: "Completed", count: c.succeeded, tone: "success" as const, hint: "Settled" },
  ];
}
