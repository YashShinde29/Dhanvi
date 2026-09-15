import type { Group } from "@dhanvi/types";
import { formatDate } from "@dhanvi/utils";
import { termsCurrent } from "./group-workflow";
import type { WorkflowStep, WorkflowSummary } from "./workflow-status";

/** Application → Organizer review → Terms acceptance → Membership active. */
export function membershipSteps(group: Group): WorkflowStep[] {
  const own = group.myMembership;
  const terms = termsCurrent(own, group);
  const stage = !own ? 0 : own.status === "APPLIED" ? 1 : own.status === "APPROVED" && !terms ? 2 : own.status === "APPROVED" ? 3 : own.status === "ACTIVE" || own.status === "COMPLETED" ? 4 : -1;
  const s = (i: number, active: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (stage === -1 ? "upcoming" : i < stage ? "complete" : i === stage ? active : "upcoming");
  return [
    { id: "apply", label: "Apply to join", state: s(0) },
    { id: "review", label: "Organizer review", state: s(1, "waiting"), hint: own?.status === "APPLIED" ? `Submitted ${formatDate(own.appliedAt)}` : own?.approvedAt ? `Approved ${formatDate(own.approvedAt)}` : undefined },
    { id: "terms", label: "Accept the rules", state: s(2, "attention"), hint: own?.termsAcceptedAt && terms ? `Accepted ${formatDate(own.termsAcceptedAt)}` : undefined },
    { id: "ready", label: "Waiting for the group to start", state: s(3, "waiting"), hint: stage === 3 ? `${group.availableSlots} position${group.availableSlots === 1 ? "" : "s"} open` : undefined },
    { id: "active", label: "Active member", state: s(4) },
  ];
}

export function membershipSummary(group: Group): WorkflowSummary {
  const own = group.myMembership;
  const steps = membershipSteps(group);
  const organizer = group.creatorType === "PLATFORM" ? "Dhanvi" : group.organizer?.name ?? "the organizer";
  if (!own) return { stage: group.status === "RECRUITING" ? "Positions open" : "Not a member", status: group.status === "RECRUITING" ? "current" : "upcoming", headline: group.status === "RECRUITING" ? `${group.availableSlots} of ${group.memberLimit} positions are open.` : "This group is not accepting applications.", steps, responsibleRole: "USER", next: "Your application goes to the organizer for review." };
  switch (own.status) {
    case "APPLIED": return { stage: "Application submitted", status: "waiting", headline: `Waiting for ${organizer} to review your application.`, detail: `Submitted ${formatDate(own.appliedAt)}. No action is required from you.`, steps, responsibleRole: "ORGANIZER", waitingFor: `${organizer} to approve your application`, next: "After approval you review and accept the group rules." };
    case "APPROVED":
      if (!termsCurrent(own, group) && group.currentRules) return { stage: "Approved · accept the rules", status: "attention", headline: "Your application was approved.", steps, responsibleRole: "USER", next: "Once every member accepts, the organizer confirms and starts the group.", action: { title: "Review and accept the group rules", description: `Rules version ${group.rulesVersion}. Your position is reserved until you accept.`, status: "attention", responsibleRole: "USER", actionLabel: "Review terms", onAction: undefined } };
      return { stage: "You're in", status: "waiting", headline: group.status === "READY_TO_START" ? `The group starts ${formatDate(group.startDate)}.` : `Waiting for ${group.availableSlots > 0 ? `${group.availableSlots} more member${group.availableSlots === 1 ? "" : "s"} to join` : "the organizer to confirm the group"}.`, detail: `Rules accepted ${own.termsAcceptedAt ? formatDate(own.termsAcceptedAt) : ""}. No action is required from you.`, steps, responsibleRole: "ORGANIZER", waitingFor: group.availableSlots > 0 ? "remaining positions to be filled" : "the organizer to start the group" };
    case "ACTIVE": return { stage: "Active member", status: "current", headline: `You are an active member${own.slotNumber ? ` in position #${own.slotNumber}` : ""}.`, steps, responsibleRole: "USER", next: own.hasBeenSelectedForPayout ? `You received the cycle ${own.payoutCycleNumber} payout right. Keep contributing every cycle.` : "Contribute each cycle until your payout turn." };
    case "REJECTED": return { stage: "Application not approved", status: "blocked", headline: own.rejectedReason || "The organizer did not approve this application.", steps, blockedBy: own.rejectedReason ?? undefined };
    case "COMPLETED": return { stage: "Group completed", status: "complete", headline: "This group finished all of its cycles.", steps };
    default: return { stage: "Membership ended", status: "blocked", headline: "You are no longer part of this group.", steps };
  }
}
