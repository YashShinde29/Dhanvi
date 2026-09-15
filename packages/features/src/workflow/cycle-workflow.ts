import type { Contribution, Group, MonthlyCycle } from "@dhanvi/types";
import { formatDate, statusGuidance } from "@dhanvi/utils";
import type { WorkflowStep, WorkflowSummary } from "./workflow-status";

/** Cycle timeline: Contributions → Selection → Payout → Completion. */
export function cycleSteps(cycle: MonthlyCycle): WorkflowStep[] {
  const rank: Record<string, number> = { UPCOMING: -1, COLLECTING_CONTRIBUTIONS: 0, CONTRIBUTIONS_COMPLETE: 1, READY_FOR_SELECTION: 1, SELECTION_COMPLETED: 2, PAYOUT_PENDING: 2, PAYOUT_COMPLETED: 3, COMPLETED: 4, SUSPENDED: -2 };
  const current = rank[cycle.status] ?? -1;
  const auction = cycle.selectionMethod === "AUCTION";
  const state = (i: number): WorkflowStep["state"] => (cycle.status === "SUSPENDED" ? (i === 0 ? "blocked" : "upcoming") : i < current ? "complete" : i === current ? (i === 2 && cycle.status === "PAYOUT_PENDING" ? "waiting" : i === 1 && cycle.status === "READY_FOR_SELECTION" ? "waiting" : "current") : "upcoming");
  return [
    { id: "contributions", label: "Contributions", state: state(0), hint: current === 0 ? `Due ${formatDate(cycle.contributionDueDate)}` : current > 0 ? "Complete" : undefined },
    { id: "selection", label: auction ? "Auction" : "Selection", state: state(1), hint: current <= 1 ? `${formatDate(cycle.selectionDate)}` : cycle.selectionCompletedAt ? `Done ${formatDate(cycle.selectionCompletedAt, cycle.groupTimeZone)}` : "Complete" },
    { id: "payout", label: "Payout", state: state(2), hint: current === 2 ? (cycle.status === "PAYOUT_PENDING" ? "Processing" : "Preparing settlement") : current < 2 ? `Scheduled ${formatDate(cycle.payoutDate)}` : "Settled" },
    { id: "completion", label: "Cycle complete", state: current >= 4 ? "complete" : current === 3 ? "current" : "upcoming" },
  ];
}

export function cycleSummary(cycle: MonthlyCycle, group: Group, viewer: "member" | "organizer" | "admin", own?: Contribution): WorkflowSummary {
  const guide = statusGuidance("cycle", cycle.status);
  const financial = cycle.collectionMode === "RAZORPAY";
  const done = financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount;
  const remaining = cycle.expectedMemberCount - done;
  const steps = cycleSteps(cycle);
  const summary: WorkflowSummary = { stage: `Cycle ${cycle.cycleNumber} of ${group.durationMonths} · ${guide.stage}`, status: "current", headline: guide.description, steps, responsibleRole: guide.nextActor === "NONE" ? undefined : guide.nextActor };
  if (cycle.status === "COLLECTING_CONTRIBUTIONS") {
    summary.headline = `${done} of ${cycle.expectedMemberCount} contributions ${financial ? "settled" : "recorded"}`;
    summary.waitingFor = remaining > 0 ? `${remaining} member${remaining === 1 ? "" : "s"}` : undefined;
    if (viewer === "member" && own && own.financialStatus.toUpperCase() !== "SETTLED" && own.status !== "RECORDED") summary.status = "attention";
    else if (remaining > 0) summary.status = "waiting";
  } else if (cycle.status === "READY_FOR_SELECTION" || cycle.status === "CONTRIBUTIONS_COMPLETE") {
    summary.status = viewer === "member" ? "waiting" : "attention";
    summary.headline = "All required contributions are complete";
    summary.waitingFor = viewer === "member" ? `the ${group.creatorType === "PLATFORM" ? "Dhanvi admin" : "organizer"} to ${cycle.selectionMethod === "AUCTION" ? "run the auction" : "start the selection"}` : undefined;
  } else if (cycle.status === "SELECTION_COMPLETED") { summary.status = viewer === "admin" ? "attention" : "waiting"; summary.waitingFor = viewer === "admin" ? undefined : "Dhanvi to prepare the payout"; summary.next = "Payout preparation, then the next cycle."; }
  else if (cycle.status === "PAYOUT_PENDING") { summary.status = "waiting"; summary.waitingFor = "payout provider confirmation"; summary.next = `Cycle ${cycle.cycleNumber + 1} opens after the payout settles.`; }
  else if (cycle.status === "PAYOUT_COMPLETED" || cycle.status === "COMPLETED") { summary.status = "complete"; summary.headline = `Cycle ${cycle.cycleNumber} is complete.`; summary.next = cycle.cycleNumber < group.durationMonths ? `Cycle ${cycle.cycleNumber + 1} starts next.` : "This was the final cycle."; }
  else if (cycle.status === "SUSPENDED") { summary.status = "blocked"; summary.blockedBy = "The group is suspended."; }
  return summary;
}
