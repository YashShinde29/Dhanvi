import type { AdminGroupRow, AdminOverview, AttentionBucket } from "@dhanvi/types";
import type { WorkflowAction } from "./workflow-status";

/** Presentation-only health for the admin group table. Underlying lifecycle/cycle states are untouched. */
export type HealthLevel = "healthy" | "attention" | "blocked" | "waiting" | "completed" | "closed";
export interface GroupHealth { level: HealthLevel; label: string; reason: string }
const LABEL: Record<HealthLevel, string> = { healthy: "Healthy", attention: "Attention required", blocked: "Blocked", waiting: "Waiting on others", completed: "Completed", closed: "Closed" };
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function groupHealth(g: AdminGroupRow): GroupHealth {
  const h = (level: HealthLevel, reason: string): GroupHealth => ({ level, label: LABEL[level], reason });
  const c = g.currentCycle, platform = g.creatorType === "PLATFORM";
  if (g.status === "COMPLETED") return h("completed", "All cycles are complete.");
  if (g.status === "CANCELLED") return h("closed", g.statusReason ?? "Cancelled.");
  if (g.status === "SUSPENDED") return h("blocked", g.statusReason ? `Suspended: ${g.statusReason}` : "Suspended by Dhanvi.");
  if (g.payments.reconciliationRequired > 0) return h("blocked", `${n(g.payments.reconciliationRequired, "payment")} need reconciliation.`);
  if (g.payouts.reconciliationRequired > 0) return h("blocked", `${n(g.payouts.reconciliationRequired, "payout")} with a reconciliation mismatch.`);
  if (g.payouts.failed > 0) return h("attention", `${n(g.payouts.failed, "payout")} failed and can be retried.`);
  if (c?.auctionStatus === "CLOSED_NO_BIDS") return h("blocked", `Cycle ${c.cycleNumber} auction closed without bids.`);
  if (g.payouts.approvalRequired > 0) return h("attention", `${n(g.payouts.approvalRequired, "payout")} waiting for approval.`);
  if (g.payouts.approved > 0) return h("attention", `${n(g.payouts.approved, "approved payout")} ready to execute.`);
  if (c?.status === "SELECTION_COMPLETED" && Object.values(g.payouts).every((v) => v === 0)) return g.collectionMode === "RAZORPAY" ? h("attention", `Cycle ${c.cycleNumber} selection complete · payouts not prepared.`) : h("waiting", `Cycle ${c.cycleNumber} selection recorded · manual-tracking group, no gateway payout.`);
  if (g.payouts.pendingBeneficiary > 0) return h("blocked", `${n(g.payouts.pendingBeneficiary, "payout")} waiting for a member bank account.`);
  if (c?.status === "READY_FOR_SELECTION") return platform ? h("attention", `Cycle ${c.cycleNumber} is ready for ${c.selectionMethod === "AUCTION" ? "the auction" : "selection"}.`) : h("waiting", `Cycle ${c.cycleNumber} ready · the organizer runs the ${c.selectionMethod === "AUCTION" ? "auction" : "selection"}.`);
  if (g.status === "READY_TO_START") return platform ? h("attention", "Ready to activate.") : h("waiting", "Ready · the organizer activates the group.");
  if (g.status === "FULLY_SUBSCRIBED") return g.termsPendingCount > 0 ? h("waiting", `${n(g.termsPendingCount, "member")} still need to accept the rules.`) : platform ? h("attention", "Every member accepted the rules · confirm ready.") : h("waiting", "Fully subscribed · the organizer confirms readiness.");
  if (g.pendingApplications > 0) return platform ? h("attention", `${n(g.pendingApplications, "application")} waiting for review.`) : h("waiting", `${n(g.pendingApplications, "application")} waiting for the organizer.`);
  if (c?.status === "COLLECTING_CONTRIBUTIONS" && c.outstandingMemberCount > 0 && c.contributionDueDate < new Date().toISOString().slice(0, 10)) return h("attention", `${n(c.outstandingMemberCount, "contribution")} overdue since ${c.contributionDueDate}.`);
  if (g.status === "DRAFT") return h("waiting", platform ? "Draft · publish to open applications." : "Draft · the organizer publishes it.");
  if (c?.status === "COLLECTING_CONTRIBUTIONS") return h("healthy", `${c.settledMemberCount} of ${c.expectedMemberCount} contributions settled.`);
  if (c?.status === "PAYOUT_PENDING") return h("healthy", "Payout processing with the provider.");
  return h("healthy", "Progressing normally.");
}

export const HEALTH_OPTIONS: { value: HealthLevel | ""; label: string }[] = [{ value: "", label: "Any health" }, { value: "attention", label: "Attention required" }, { value: "blocked", label: "Blocked" }, { value: "waiting", label: "Waiting on others" }, { value: "healthy", label: "Healthy" }, { value: "completed", label: "Completed" }];

/** "Requires attention" items for the admin dashboard: one line, severity, oldest age and exactly one CTA each. */
export function adminAttention(o: AdminOverview): WorkflowAction[] {
  const items: WorkflowAction[] = [];
  const add = (b: AttentionBucket, id: string, title: (c: number) => string, description: string, status: WorkflowAction["status"], role: WorkflowAction["responsibleRole"], actionLabel: string, actionHref: string, priority: number) => {
    if (b.count > 0) items.push({ id, title: title(b.count), description, status, responsibleRole: role, since: b.oldestSince, actionLabel, actionHref, priority });
  };
  add(o.payments.reconciliationRequired, "pay-recon", (c) => `${n(c, "payment")} need reconciliation`, "Provider data did not match. Contributions stay unsettled until reviewed.", "blocked", "FINANCE", "Review payments", "/reconciliation", 1);
  add(o.payouts.reconciliationRequired, "po-recon", (c) => `${n(c, "payout")} with a reconciliation mismatch`, "Settlement and retries are blocked until reviewed.", "blocked", "FINANCE", "Review payouts", "/reconciliation", 1);
  add(o.payouts.failed, "po-failed", (c) => `${n(c, "payout")} failed`, "The provider transfer failed and can be retried.", "attention", "FINANCE", "Review failed payouts", "/payouts?status=FAILED", 2);
  add(o.groups.auctionsClosedNoBids, "auction-nobids", (c) => `${n(c, "auction")} closed without bids`, "No payout right was assigned. The cycle needs review.", "blocked", "ADMIN", "Review groups", "/groups?health=blocked", 2);
  add(o.groups.platformCyclesReadyForSelection, "sel", (c) => `${n(c, "cycle")} ready for selection`, "All contributions are settled. Members are waiting for the result.", "attention", "ADMIN", "Open groups", "/groups?cycleStatus=READY_FOR_SELECTION&creatorType=PLATFORM", 3);
  add(o.groups.cyclesSelectionCompleted, "prep", (c) => `${n(c, "cycle")} waiting for payout preparation`, "Selection is complete; the winner is waiting for the payout.", "attention", "FINANCE", "Open groups", "/groups?cycleStatus=SELECTION_COMPLETED", 4);
  add(o.payouts.approvalRequired, "po-approve", (c) => `${n(c, "payout")} waiting for approval`, "Funding and beneficiary are ready.", "attention", "FINANCE", "Review payouts", "/payouts?status=PENDING_BENEFICIARY", 5);
  add(o.payouts.readyToExecute, "po-exec", (c) => `${n(c, "approved payout")} ready to execute`, "Recipients are waiting for the transfer.", "attention", "FINANCE", "Execute payouts", "/payouts?status=APPROVED", 5);
  add(o.groups.platformReadyToActivate, "activate", (c) => `${n(c, "group")} ready to start`, "Members are waiting for the schedule.", "attention", "ADMIN", "Open groups", "/groups?status=READY_TO_START&creatorType=PLATFORM", 6);
  add(o.groups.platformReadyToConfirm, "confirm", (c) => `${n(c, "group")} ready to confirm`, "All positions reserved and every member accepted the rules.", "attention", "ADMIN", "Open groups", "/groups?status=FULLY_SUBSCRIBED&creatorType=PLATFORM", 7);
  add(o.groups.cyclesOverdueCollecting, "overdue", (c) => `${n(c, "cycle")} past the contribution due date`, "Contributions are still outstanding after the due date.", "attention", "USER", "Open groups", "/groups?cycleStatus=COLLECTING_CONTRIBUTIONS&health=attention", 8);
  add(o.organizers.applicationsPending, "org-apps", (c) => `${n(c, "organizer application")} pending review`, "Applicants cannot create groups until approved.", "attention", "ADMIN", "Review applications", "/organizers", 9);
  add(o.groups.platformApplicationsPending, "member-apps", (c) => `${n(c, "membership application")} waiting for review`, "Platform groups cannot fill until applications are reviewed.", "attention", "ADMIN", "Open groups", "/groups?status=RECRUITING&creatorType=PLATFORM", 10);
  add(o.groups.suspendedGroups, "suspended", (c) => `${n(c, "suspended group")}`, "Contributions, selections and bids are paused for members.", "blocked", "ADMIN", "Review groups", "/groups?status=SUSPENDED", 11);
  return items;
}

/** Things moving without admin action: shown compactly so the dashboard stays about exceptions. */
export function adminWaiting(o: AdminOverview): WorkflowAction[] {
  const items: WorkflowAction[] = [];
  const add = (b: AttentionBucket, id: string, title: (c: number) => string, role: WorkflowAction["responsibleRole"], href: string) => { if (b.count > 0) items.push({ id, title: title(b.count), status: "waiting", responsibleRole: role, since: b.oldestSince, actionLabel: "View", actionHref: href }); };
  add(o.payouts.pendingBeneficiary, "po-acct", (c) => `${n(c, "payout")} waiting for a member bank account`, "USER", "/payouts?status=PENDING_BENEFICIARY");
  add(o.payouts.processing, "po-provider", (c) => `${n(c, "payout")} processing with the provider`, "SYSTEM", "/payouts?status=PROCESSING");
  add(o.payments.pending, "pay-pending", (c) => `${n(c, "payment")} awaiting a verified capture`, "SYSTEM", "/payments?status=PENDING");
  add(o.groups.organizerCyclesReadyForSelection, "org-sel", (c) => `${n(c, "organizer cycle")} ready · organizer runs the selection`, "ORGANIZER", "/groups?cycleStatus=READY_FOR_SELECTION&creatorType=ORGANIZER");
  add(o.groups.organizerGroupsAwaitingOrganizer, "org-groups", (c) => `${n(c, "organizer group")} waiting for the organizer to confirm or activate`, "ORGANIZER", "/groups?creatorType=ORGANIZER&health=waiting");
  add(o.groups.auctionsOpen, "auctions-open", (c) => `${n(c, "auction")} open for bidding`, "USER", "/groups?cycleStatus=READY_FOR_SELECTION");
  return items;
}
