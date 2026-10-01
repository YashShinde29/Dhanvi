import type { Contribution, Group, Member, MonthlyCycle } from "@dhanvi/types";
import { formatDate, formatMoney, statusGuidance } from "@dhanvi/utils";
import { managePrefix } from "../groups/shared";
import { cycleSteps } from "./cycle-workflow";
import type { WorkflowAction, WorkflowStep, WorkflowSummary } from "./workflow-status";

export type Viewer = "member" | "organizer" | "admin";
export interface GroupWorkflowInput {
  group: Group; viewer: Viewer; scope: "public" | "mine" | "organizer" | "admin";
  currentCycle?: MonthlyCycle; ownContribution?: Contribution; members?: Member[]; canManage?: boolean;
}

export const termsCurrent = (m: Member | null | undefined, g: Group) => !!m?.termsAcceptedAt && m.termsVersionId === g.currentRules?.id;

/** Lifecycle steps for a group: Draft → Accepting members → Group full → Ready → Active (cycles) → Completed. */
export function groupSteps(g: Group, currentCycle?: MonthlyCycle): WorkflowStep[] {
  const order = ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE", "COMPLETED"];
  const rank = g.status === "PUBLISHED" ? 1 : g.status === "COMPLETING" ? 4 : order.indexOf(g.status);
  const state = (i: number, s: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (i < rank ? "complete" : i === rank ? s : "upcoming");
  const halted = g.status === "SUSPENDED" || g.status === "CANCELLED";
  const steps: WorkflowStep[] = [
    { id: "created", label: "Group created", state: rank > 0 ? "complete" : "current", hint: g.status === "DRAFT" ? "Draft, not published" : undefined },
    { id: "recruiting", label: "Members joining", state: state(1), hint: rank === 1 ? `${g.currentMemberCount} of ${g.memberLimit} positions filled` : undefined },
    { id: "full", label: "Group full", state: state(2, "waiting"), hint: rank === 2 ? "Members accepting rules" : undefined },
    { id: "ready", label: "Ready to start", state: state(3), hint: rank === 3 ? `Starts ${formatDate(g.startDate)}` : undefined },
    { id: "active", label: "Active", state: state(4), hint: g.currentCycleNumber ? `Cycle ${g.currentCycleNumber} of ${g.durationMonths}` : undefined },
    { id: "completed", label: "Group completed", state: rank >= 5 ? "complete" : "upcoming" },
  ];
  if (halted) steps.forEach((s) => { if (s.state === "current" || s.state === "waiting") s.state = "blocked"; });
  if (rank === 4 && currentCycle) steps.splice(5, 0, ...cycleSteps(currentCycle).map((s) => ({ ...s, id: `cycle-${s.id}`, label: `Cycle ${currentCycle.cycleNumber}: ${s.label}` })));
  return steps;
}

/** The "Group progress" card content for any viewer. Derived purely from backend state. */
export function groupSummary({ group: g, viewer, scope, currentCycle, ownContribution, members = [], canManage = false }: GroupWorkflowInput): WorkflowSummary {
  const guide = statusGuidance("group", g.status);
  const prefix = managePrefix(scope === "organizer" ? "organizer" : scope === "admin" ? "admin" : "public");
  const base = `${prefix}/groups/${g.id}`;
  const own = g.myMembership;
  const manage = viewer !== "member";
  const steps = groupSteps(g, currentCycle);
  const pendingApplications = manage ? members.filter((m) => m.status === "APPLIED").length : g.pendingApplications;
  const termsPending = members.filter((m) => m.status === "APPROVED" && !termsCurrent(m, g)).length;
  const summary: WorkflowSummary = { stage: guide.stage, status: "current", headline: guide.description, steps, responsibleRole: guide.nextActor === "NONE" ? undefined : guide.nextActor };

  switch (g.status) {
    case "DRAFT":
      summary.headline = "Saved as a draft. Members cannot see it yet.";
      summary.next = "Members apply for positions once published.";
      if (canManage) summary.action = { title: "Publish the group", description: "Publishing locks the rules snapshot as version 1 and opens applications.", actionLabel: "Review & publish", actionHref: base, status: "current", responsibleRole: "ORGANIZER" };
      break;
    case "PUBLISHED":
    case "RECRUITING": {
      const open = g.availableSlots;
      summary.headline = `${g.currentMemberCount} of ${g.memberLimit} positions filled · ${open} still open`;
      summary.waitingFor = open > 0 ? `${open} more member${open === 1 ? "" : "s"} to join` : undefined;
      summary.next = "When every position is approved and accepted, the organizer confirms the group is ready.";
      if (manage && pendingApplications > 0) summary.action = { title: `${pendingApplications} application${pendingApplications === 1 ? "" : "s"} waiting for your review`, actionLabel: "Review applications", actionHref: `${base}${scope === "organizer" ? "/applications" : ""}`, status: "attention", responsibleRole: "ORGANIZER" };
      else if (manage) summary.responsibleRole = "USER";
      if (!manage && own?.status === "APPLIED") { summary.status = "waiting"; summary.waitingFor = "the organizer to review your application"; summary.responsibleRole = "ORGANIZER"; summary.next = "After approval you review and accept the group rules."; }
      if (!manage && own?.status === "APPROVED" && !termsCurrent(own, g) && g.currentRules) { summary.status = "attention"; summary.action = { title: "Accept the group rules", description: "Your application was approved. Review the rules to hold your position.", actionLabel: "Review & accept", actionHref: `/groups/${g.id}`, status: "attention", responsibleRole: "USER" }; summary.responsibleRole = "USER"; }
      if (!manage && own?.status === "APPROVED" && termsCurrent(own, g)) { summary.status = "waiting"; summary.waitingFor = `${open} more member${open === 1 ? "" : "s"} to join`; summary.responsibleRole = "ORGANIZER"; }
      if (!manage && !own && g.status === "RECRUITING") summary.action = { title: "Apply for a position", description: `${open} position${open === 1 ? "" : "s"} open · ${formatMoney(g.monthlyContribution)} per month.`, actionLabel: "Apply to join", actionHref: `/groups/${g.id}`, status: "current", responsibleRole: "USER" };
      break;
    }
    case "FULLY_SUBSCRIBED":
      summary.headline = termsPending > 0 ? `All positions reserved · ${termsPending} member${termsPending === 1 ? "" : "s"} still need to accept the rules` : "All positions reserved and every member has accepted the rules";
      summary.status = termsPending > 0 ? "waiting" : "attention";
      if (termsPending > 0) { summary.waitingFor = `${termsPending} approved member${termsPending === 1 ? "" : "s"} to accept the rules`; summary.blockedBy = manage ? "Confirming readiness is unavailable until every approved member accepts the rules." : undefined; summary.responsibleRole = "USER"; }
      else if (canManage) summary.action = { title: "Confirm the group is ready to start", actionLabel: "Open group actions", actionHref: base, status: "attention", responsibleRole: "ORGANIZER" };
      if (!manage && own?.status === "APPROVED" && !termsCurrent(own, g) && g.currentRules) { summary.status = "attention"; summary.action = { title: "Accept the group rules", description: "The group cannot start until you accept.", actionLabel: "Review & accept", actionHref: `/groups/${g.id}`, status: "attention", responsibleRole: "USER" }; }
      summary.next = "The organizer confirms readiness, then activates the group on its start date.";
      break;
    case "READY_TO_START":
      summary.headline = `Ready to start · first cycle begins ${formatDate(g.startDate)}`;
      summary.status = canManage ? "attention" : "waiting";
      summary.waitingFor = canManage ? undefined : "the organizer to activate the group";
      summary.next = "Activation creates every monthly cycle and the first contribution schedule.";
      if (canManage) summary.action = { title: "Activate the group", description: "Creates the full contribution and selection schedule. Core rules lock permanently.", actionLabel: "Open group actions", actionHref: base, status: "attention", responsibleRole: "ORGANIZER" };
      break;
    case "ACTIVE": {
      if (!currentCycle) { summary.headline = g.currentCycleNumber ? `Cycle ${g.currentCycleNumber} of ${g.durationMonths}` : "Active"; break; }
      const cycleGuide = statusGuidance("cycle", currentCycle.status);
      const financial = currentCycle.collectionMode === "RAZORPAY";
      const done = financial ? currentCycle.financiallySettledMemberCount : currentCycle.fullyRecordedMemberCount;
      const remaining = currentCycle.expectedMemberCount - done;
      summary.stage = `Cycle ${currentCycle.cycleNumber} · ${cycleGuide.stage}`;
      summary.position = { current: currentCycle.cycleNumber, total: g.durationMonths, label: "Cycle" };
      if (currentCycle.status === "COLLECTING_CONTRIBUTIONS") {
        summary.headline = `${done} of ${currentCycle.expectedMemberCount} contributions ${financial ? "settled" : "recorded"}`;
        summary.waitingFor = remaining > 0 ? (financial ? `${remaining} member${remaining === 1 ? " still needs" : "s still need"} to pay` : `${remaining} contribution${remaining === 1 ? "" : "s"} still to be recorded`) : undefined;
        summary.next = `Once all contributions are complete, the ${currentCycle.selectionMethod === "AUCTION" ? "auction" : "selection"} can run.`;
        summary.responsibleRole = manage && !financial ? "ORGANIZER" : "USER";
        if (!manage && ownContribution && ownContribution.financialStatus.toUpperCase() !== "SETTLED" && ownContribution.status !== "RECORDED") {
          const due = ownContribution.expectedAmount - (financial ? ownContribution.financiallySettledAmount : ownContribution.recordedAmount);
          summary.status = "attention";
          summary.action = financial
            ? { title: `Pay your cycle ${currentCycle.cycleNumber} contribution`, description: `Due ${formatDate(ownContribution.dueDate)}.`, amount: due, actionLabel: "Pay contribution", actionHref: `/contributions?groupId=${g.id}`, status: "attention", responsibleRole: "USER" }
            : { title: `Your cycle ${currentCycle.cycleNumber} contribution is due`, description: `Due ${formatDate(ownContribution.dueDate)} · your organizer records it once received.`, amount: due, actionLabel: "View contribution", actionHref: `/contributions?groupId=${g.id}`, status: "current", responsibleRole: "USER" };
        } else if (!manage && ownContribution) { summary.status = "waiting"; summary.headline = `Your contribution is complete · ${done} of ${currentCycle.expectedMemberCount} members done`; summary.waitingFor = remaining > 0 ? `${remaining} other member${remaining === 1 ? "" : "s"}` : undefined; }
        else if (manage && !financial && remaining > 0) summary.action = { title: `Record ${remaining} outstanding contribution${remaining === 1 ? "" : "s"}`, actionLabel: "Manage contributions", actionHref: `${base}/cycles/${currentCycle.id}/contributions`, status: "current", responsibleRole: "ORGANIZER" };
        else if (manage && remaining > 0) { summary.status = "waiting"; summary.action = { title: "Track who still needs to pay", actionLabel: "View contributions", actionHref: `${base}/cycles/${currentCycle.id}/contributions`, status: "waiting", responsibleRole: "USER" }; }
      } else if (currentCycle.status === "READY_FOR_SELECTION" || currentCycle.status === "CONTRIBUTIONS_COMPLETE") {
        summary.headline = "All contributions are complete";
        const auction = currentCycle.selectionMethod === "AUCTION";
        summary.responsibleRole = "ORGANIZER";
        summary.next = auction ? "The auction winner receives this cycle's payout right." : "The selected member receives this cycle's payout right.";
        if (canManage) { summary.status = "attention"; summary.action = { title: auction ? "Run the auction" : "Start the selection", actionLabel: auction ? "Open auction" : "Run selection", actionHref: auction ? `${base}/cycles/${currentCycle.id}/auction` : `${base}?tab=cycles`, status: "attention", responsibleRole: "ORGANIZER" }; }
        else { summary.status = "waiting"; summary.waitingFor = `the ${g.creatorType === "PLATFORM" ? "Dhanvi admin" : "organizer"} to ${auction ? "open the auction" : "start the selection"}`; if (auction && !manage) summary.action = { title: "Auction for this cycle", description: `Scheduled ${formatDate(currentCycle.selectionDate)}.`, actionLabel: "View auction", actionHref: `/groups/${g.id}/cycles/${currentCycle.id}/auction`, status: "waiting", responsibleRole: "ORGANIZER" }; }
      } else if (currentCycle.status === "SELECTION_COMPLETED") {
        summary.headline = "Selection completed · payout recipient recorded";
        summary.status = viewer === "admin" ? "attention" : "waiting";
        summary.responsibleRole = "ADMIN";
        summary.waitingFor = viewer === "admin" ? undefined : "Dhanvi to prepare and process the payout";
        summary.next = "After the payout settles, the next cycle opens.";
        if (viewer === "admin") summary.action = { title: "Prepare the payout settlement", actionLabel: "Open payouts", actionHref: `/payouts?groupId=${g.id}&cycleId=${currentCycle.id}`, status: "attention", responsibleRole: "FINANCE" };
        else summary.action = { title: "See the result", actionLabel: "View selection", actionHref: `${base}?tab=cycles`, status: "complete", responsibleRole: "SYSTEM" };
      } else if (currentCycle.status === "PAYOUT_PENDING") {
        summary.headline = "Payout is being processed"; summary.status = "waiting"; summary.responsibleRole = "SYSTEM"; summary.waitingFor = "payout provider confirmation"; summary.next = "The next cycle opens after the payout settles.";
      } else if (currentCycle.status === "PAYOUT_COMPLETED" || currentCycle.status === "COMPLETED") {
        summary.headline = `Cycle ${currentCycle.cycleNumber} complete`; summary.status = "complete"; summary.next = currentCycle.cycleNumber < g.durationMonths ? `Cycle ${currentCycle.cycleNumber + 1} starts next.` : "This was the final cycle."; summary.responsibleRole = "SYSTEM";
      } else if (currentCycle.status === "SUSPENDED") { summary.status = "blocked"; summary.blockedBy = "The group is suspended by Dhanvi."; summary.responsibleRole = "ADMIN"; }
      break;
    }
    case "COMPLETED": {
      const paid = members.filter((m) => m.hasBeenSelectedForPayout).length;
      summary.status = "complete"; summary.headline = "All cycles have been completed. No further contributions are required."; summary.detail = members.length ? `${paid} of ${members.length} members received their payout rights.` : undefined; summary.responsibleRole = undefined;
      break;
    }
    case "SUSPENDED": summary.status = "blocked"; summary.blockedBy = g.statusReason ?? "Suspended by Dhanvi."; summary.responsibleRole = "ADMIN"; break;
    case "CANCELLED": summary.status = "blocked"; summary.headline = "This group was cancelled."; summary.blockedBy = g.statusReason ?? "Cancelled."; summary.responsibleRole = undefined; break;
  }
  return summary;
}

/** Dashboard-level actions/waiting items for the groups a member belongs to. */
export function memberGroupActions(groups: Group[]): { actions: WorkflowAction[]; waiting: WorkflowAction[] } {
  const actions: WorkflowAction[] = [], waiting: WorkflowAction[] = [];
  for (const g of groups) {
    const m = g.myMembership; if (!m) continue;
    if (m.status === "APPLIED") waiting.push({ id: `applied-${g.id}`, title: `Waiting for organizer approval · ${g.name}`, description: `Application submitted ${formatDate(m.appliedAt)}.`, status: "waiting", responsibleRole: "ORGANIZER", since: m.appliedAt, actionLabel: "View group", actionHref: `/groups/${g.id}` });
    else if (m.status === "APPROVED" && g.currentRules && !termsCurrent(m, g) && ["RECRUITING", "FULLY_SUBSCRIBED"].includes(g.status)) actions.push({ id: `terms-${g.id}`, title: "Accept group terms", description: `Your application to ${g.name} was approved. Accept rules version ${g.rulesVersion} to hold your position.`, status: "attention", responsibleRole: "USER", actionLabel: "Review & accept", actionHref: `/groups/${g.id}`, priority: 10 });
    else if (m.status === "APPROVED" && ["RECRUITING", "FULLY_SUBSCRIBED"].includes(g.status)) waiting.push({ id: `fill-${g.id}`, title: `Waiting for ${g.availableSlots > 0 ? `${g.availableSlots} more member${g.availableSlots === 1 ? "" : "s"}` : "the organizer to confirm the group"} · ${g.name}`, status: "waiting", responsibleRole: g.availableSlots > 0 ? "ORGANIZER" : "ORGANIZER", actionLabel: "View group", actionHref: `/groups/${g.id}` });
    else if (g.status === "READY_TO_START") waiting.push({ id: `start-${g.id}`, title: `Waiting for ${g.name} to start`, description: `Starts ${formatDate(g.startDate)}.`, status: "waiting", responsibleRole: "ORGANIZER", actionLabel: "View group", actionHref: `/groups/${g.id}` });
  }
  return { actions, waiting };
}
