import type { AdminCycleSnapshot, AdminPayoutCounts, Group, MonthlyCycle } from "@dhanvi/types";
import { formatDate, statusGuidance } from "@dhanvi/utils";
import type { ResponsibleRole, WorkflowState } from "./workflow-status";

/**
 * Central "next action engine" for a group as seen by the party that operates it (Dhanvi admin for platform groups,
 * the organizer for organizer groups). It derives ONE primary action, a few secondary links and the overflow from
 * backend state. Pages map action ids to handlers; nothing here calls the API or decides authorization — the
 * `canManage` flag mirrors what the backend enforces (admins manage platform groups; organizers manage their own).
 */
export type ControlActionId = "publish" | "edit-draft" | "review-applications" | "confirm-ready" | "activate" | "start-selection" | "record-organizer-payout"
  | "open-auction" | "close-auction" | "prepare-payouts" | "review-payouts" | "review-payments" | "manage-contributions" | "mark-overdue" | "view-ledger" | "suspend" | "cancel";
export interface ControlAction { id: ControlActionId; label: string; href?: string; danger?: boolean }

/** Normalised cycle facts (works for both the member-facing MonthlyCycle DTO and the admin snapshot). */
export interface CycleFacts {
  id: string; cycleNumber: number; status: string; selectionMethod: string; collectionMode: "MANUAL_TRACKING" | "RAZORPAY";
  expectedMemberCount: number; settledMemberCount: number; contributionDueDate: string; selectionDate: string;
  auctionStatus: string | null; selectionCompletedAt: string | null; readyForSelectionAt: string | null;
}
export function cycleFacts(c: MonthlyCycle | AdminCycleSnapshot, auctionStatusOverride?: string | null): CycleFacts {
  const auctionStatus = auctionStatusOverride !== undefined ? auctionStatusOverride : ("auctionStatus" in c ? c.auctionStatus : null);
  const financial = c.collectionMode === "RAZORPAY";
  const settled = "settledMemberCount" in c ? c.settledMemberCount : financial ? c.financiallySettledMemberCount : c.fullyRecordedMemberCount;
  return { id: c.id, cycleNumber: c.cycleNumber, status: c.status, selectionMethod: c.selectionMethod, collectionMode: c.collectionMode, expectedMemberCount: c.expectedMemberCount, settledMemberCount: settled,
    contributionDueDate: c.contributionDueDate, selectionDate: c.selectionDate, auctionStatus, selectionCompletedAt: c.selectionCompletedAt, readyForSelectionAt: c.readyForSelectionAt };
}

export interface GroupControlInput {
  group: Pick<Group, "id" | "name" | "status" | "creatorType" | "currentMemberCount" | "memberLimit" | "availableSlots" | "startDate" | "durationMonths" | "statusReason" | "activatedAt">;
  viewer: "admin" | "organizer";
  /** True when the backend lets this viewer operate the group (admin ↔ PLATFORM, organizer ↔ own group). */
  canManage: boolean;
  pendingApplications: number;
  termsPending: number;
  currentCycle?: CycleFacts;
  /** Live auction capability flags when the current cycle is an auction (from GET …/auction). */
  auction?: { canOpen: boolean; canClose: boolean } | null;
  payouts?: AdminPayoutCounts | null;
  paymentIssues?: number;
  /** Route builders for the viewer's app. */
  hrefs: { group: string; applications: string; contributions: (cycleId: string) => string; auction: (cycleId: string) => string; payouts: string; payments?: string; ledger?: string };
}

export interface GroupControlState {
  stage: string; status: WorkflowState; headline: string; detail?: string;
  responsible?: ResponsibleRole; waitingOn?: string; blockedBy?: string; next?: string;
  primary?: ControlAction; secondary: ControlAction[]; overflow: ControlAction[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deriveGroupControl(i: GroupControlInput): GroupControlState {
  const { group: g, currentCycle: c, canManage, viewer } = i;
  const operator: ResponsibleRole = g.creatorType === "PLATFORM" ? "ADMIN" : "ORGANIZER";
  const operatorName = g.creatorType === "PLATFORM" ? "Dhanvi admin" : "the organizer";
  const guide = statusGuidance("group", g.status);
  const s: GroupControlState = { stage: guide.stage, status: "current", headline: guide.description, responsible: guide.nextActor === "NONE" ? undefined : guide.nextActor, secondary: [], overflow: [] };
  const act = (id: ControlActionId, label: string, href?: string): ControlAction => ({ id, label, href });

  switch (g.status) {
    case "DRAFT":
      s.headline = "Saved as a draft. Members cannot see it yet."; s.next = "Publishing locks rules version 1 and opens applications."; s.responsible = operator;
      if (canManage) { s.status = "attention"; s.primary = act("publish", "Publish group"); s.secondary.push(act("edit-draft", "Edit draft")); }
      break;
    case "PUBLISHED":
    case "RECRUITING": {
      const open = g.availableSlots;
      s.headline = `${g.currentMemberCount} of ${g.memberLimit} positions filled · ${plural(open, "position")} open`;
      s.next = "When every position is approved and every member has accepted the rules, the group is confirmed ready.";
      if (i.pendingApplications > 0) {
        s.status = canManage ? "attention" : "waiting"; s.responsible = operator;
        s.detail = `${plural(i.pendingApplications, "application")} waiting for review.`;
        if (canManage) s.primary = act("review-applications", `Review ${plural(i.pendingApplications, "application")}`, i.hrefs.applications);
        else s.waitingOn = `${operatorName} to review ${plural(i.pendingApplications, "application")}`;
      } else { s.status = "waiting"; s.responsible = "USER"; s.waitingOn = open > 0 ? `${plural(open, "more member")} to apply` : "members to accept the rules"; }
      if (i.termsPending > 0) s.detail = `${s.detail ? `${s.detail} ` : ""}${plural(i.termsPending, "approved member has", "approved members have")} not accepted the rules yet.`;
      break;
    }
    case "FULLY_SUBSCRIBED":
      s.headline = i.termsPending > 0 ? `All positions reserved · ${plural(i.termsPending, "member")} still need to accept the rules` : "All positions reserved and every member has accepted the rules";
      if (i.termsPending > 0) { s.status = "waiting"; s.responsible = "USER"; s.waitingOn = `${plural(i.termsPending, "approved member")} to accept the rules`; s.blockedBy = "Confirming readiness is unavailable until every approved member accepts the current rules."; }
      else { s.status = canManage ? "attention" : "waiting"; s.responsible = operator; if (canManage) s.primary = act("confirm-ready", "Confirm ready to start"); else s.waitingOn = `${operatorName} to confirm the group is ready`; }
      s.next = "After confirmation the group is activated on or after its start date.";
      break;
    case "READY_TO_START":
      s.headline = `Ready to start · first cycle from ${formatDate(g.startDate)}`; s.responsible = operator;
      s.status = canManage ? "attention" : "waiting"; s.next = "Activation creates every monthly cycle and the first contribution schedule; core rules lock permanently.";
      if (canManage) s.primary = act("activate", "Activate group"); else s.waitingOn = `${operatorName} to activate the group`;
      break;
    case "ACTIVE": {
      if (!c) { s.headline = "Active · loading the current cycle."; break; }
      const cycleGuide = statusGuidance("cycle", c.status);
      const remaining = c.expectedMemberCount - c.settledMemberCount;
      const financial = c.collectionMode === "RAZORPAY";
      const auction = c.selectionMethod === "AUCTION";
      s.stage = `Cycle ${c.cycleNumber} of ${g.durationMonths} — ${cycleGuide.stage}`;
      if (c.status === "COLLECTING_CONTRIBUTIONS") {
        s.headline = `${c.settledMemberCount} of ${c.expectedMemberCount} contributions ${financial ? "settled" : "recorded"} · ${remaining} outstanding`;
        s.responsible = financial ? "USER" : operator; s.status = "waiting";
        s.waitingOn = financial ? `${plural(remaining, "member")} to pay through Razorpay` : `${plural(remaining, "contribution")} to be recorded by ${viewer === "organizer" ? "you" : operatorName}`;
        s.next = `Once every contribution is complete the ${auction ? "auction" : "selection"} becomes available.`;
        if (!financial && canManage) { s.status = "current"; s.primary = act("manage-contributions", "Record contributions", i.hrefs.contributions(c.id)); }
        else s.secondary.push(act("manage-contributions", "View contributions", i.hrefs.contributions(c.id)));
        if (i.paymentIssues && i.paymentIssues > 0) { s.status = "blocked"; s.blockedBy = `${plural(i.paymentIssues, "payment")} need reconciliation before the contributions can settle.`; s.responsible = "FINANCE"; if (viewer === "admin" && i.hrefs.payments) s.primary = act("review-payments", "Review reconciliation", i.hrefs.payments); }
        if (canManage) s.overflow.push(act("mark-overdue", "Refresh overdue status"));
      } else if (c.status === "READY_FOR_SELECTION" || c.status === "CONTRIBUTIONS_COMPLETE") {
        s.headline = "All contributions are settled."; s.responsible = operator;
        s.next = auction ? "The auction winner receives this cycle's payout right." : "The selected member receives this cycle's payout right.";
        if (auction) {
          if (c.auctionStatus === "OPEN") { s.stage = `Cycle ${c.cycleNumber} of ${g.durationMonths} — Auction open`; s.headline = "Eligible members are bidding."; s.status = "current"; s.responsible = "USER";
            if (canManage) { if (i.auction?.canClose) { s.status = "attention"; s.primary = act("close-auction", "Close auction", i.hrefs.auction(c.id)); } else s.secondary.push(act("open-auction", "Monitor auction", i.hrefs.auction(c.id))); } }
          else if (c.auctionStatus === "CLOSED_NO_BIDS") { s.status = "blocked"; s.blockedBy = "The auction closed without bids. No payout right was assigned."; }
          else { s.stage = `Cycle ${c.cycleNumber} of ${g.durationMonths} — Ready for auction`;
            if (canManage) { if (i.auction?.canOpen) { s.status = "attention"; s.primary = act("open-auction", "Open auction", i.hrefs.auction(c.id)); } else { s.status = "waiting"; s.responsible = "SYSTEM"; s.waitingOn = "the scheduled auction window"; s.secondary.push(act("open-auction", "View auction", i.hrefs.auction(c.id))); } }
            else { s.status = "waiting"; s.waitingOn = `${operatorName} to open the auction`; } }
        } else if (canManage) { s.status = "attention"; s.primary = act(c.selectionMethod === "ORGANIZER_RESERVED" ? "record-organizer-payout" : "start-selection", c.selectionMethod === "ORGANIZER_RESERVED" ? "Record organizer payout" : "Start selection"); }
        else { s.status = "waiting"; s.waitingOn = `${operatorName} to start the selection`; }
      } else if (c.status === "SELECTION_COMPLETED") {
        const p = i.payouts; const created = p ? Object.values(p).reduce((a, b) => a + b, 0) : 0;
        s.headline = auction ? "Auction winner decided · payout stage" : "Selection completed · payout stage"; s.responsible = "FINANCE";
        s.next = "After the payout settles, the next cycle opens automatically.";
        if (viewer === "admin") {
          // Backend rule (LedgerPostingRules): payouts need a gateway-funded pool. Manual-tracking groups never fund the ledger, so preparation is not offered.
          if ((!p || created === 0) && !financial) { s.status = "blocked"; s.responsible = undefined; s.blockedBy = "Payout preparation needs a gateway-funded pool in the ledger. This group tracks contributions manually, so no payout can be prepared from Dhanvi."; s.next = "The payout right stays recorded; settlement happens outside the platform."; }
          else if (!p || created === 0) { s.status = "attention"; s.primary = act("prepare-payouts", "Prepare payouts"); s.detail = "Create the payout obligations for this cycle's result."; }
          else if (p.reconciliationRequired > 0) { s.status = "blocked"; s.blockedBy = `${plural(p.reconciliationRequired, "payout")} with a reconciliation mismatch.`; s.primary = act("review-payouts", "Review payouts", i.hrefs.payouts); }
          else if (p.failed > 0) { s.status = "attention"; s.detail = `${plural(p.failed, "payout")} failed.`; s.primary = act("review-payouts", "Review failed payout", i.hrefs.payouts); }
          else if (p.approvalRequired > 0) { s.status = "attention"; s.detail = `${plural(p.approvalRequired, "payout")} waiting for approval.`; s.primary = act("review-payouts", "Approve payouts", i.hrefs.payouts); }
          else if (p.approved > 0) { s.status = "attention"; s.detail = `${plural(p.approved, "approved payout")} ready to execute.`; s.primary = act("review-payouts", "Execute payouts", i.hrefs.payouts); }
          else if (p.pendingBeneficiary > 0) { s.status = "waiting"; s.responsible = "USER"; s.waitingOn = `${plural(p.pendingBeneficiary, "recipient")} to add a payout bank account`; s.secondary.push(act("review-payouts", "View payouts", i.hrefs.payouts)); }
          else { s.status = "waiting"; s.responsible = "SYSTEM"; s.waitingOn = "the payout provider to confirm"; s.secondary.push(act("review-payouts", "View payouts", i.hrefs.payouts)); }
        } else { s.status = "waiting"; s.responsible = "ADMIN"; s.waitingOn = "Dhanvi to prepare and process the payout"; s.secondary.push(act("review-payouts", "Payout status", i.hrefs.payouts)); }
      } else if (c.status === "PAYOUT_PENDING") { s.headline = "Payout is being processed."; s.status = "waiting"; s.responsible = "SYSTEM"; s.waitingOn = "payout provider confirmation"; s.secondary.push(act("review-payouts", "View payouts", i.hrefs.payouts)); }
      else if (c.status === "PAYOUT_COMPLETED" || c.status === "COMPLETED") { s.headline = `Cycle ${c.cycleNumber} complete.`; s.status = "complete"; s.responsible = "SYSTEM"; s.next = c.cycleNumber < g.durationMonths ? `Cycle ${c.cycleNumber + 1} opens next.` : "This was the final cycle."; }
      break;
    }
    case "COMPLETED": s.status = "complete"; s.headline = "All cycles have been completed."; s.responsible = undefined; break;
    case "SUSPENDED": s.status = "blocked"; s.blockedBy = g.statusReason ?? "Suspended by Dhanvi."; s.responsible = "ADMIN"; break;
    case "CANCELLED": s.status = "blocked"; s.headline = "This group was cancelled."; s.blockedBy = g.statusReason ?? "Cancelled."; s.responsible = undefined; break;
  }

  // Rare and destructive actions live in the overflow, never next to the primary.
  if (viewer === "admin" && i.hrefs.ledger) s.overflow.push(act("view-ledger", "View group ledger", i.hrefs.ledger));
  const cancellable = ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "SUSPENDED"].includes(g.status) && !g.activatedAt;
  if (viewer === "admin" && ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE"].includes(g.status)) s.overflow.push({ id: "suspend", label: "Suspend group", danger: true });
  if (cancellable && (viewer === "admin" || canManage)) s.overflow.push({ id: "cancel", label: "Cancel group", danger: true });
  return s;
}
