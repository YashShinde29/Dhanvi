import { requireGroup, requireRule } from "../../utils/errors.js";
import type { Contribution } from "../contribution/contribution.domain.js";
import type { Actor } from "../../types/common.types.js";
import type { SelectionContext, SelectionParticipant } from "./selection.context.js";

/** Port of SelectionPolicy — authorization, eligibility and readiness shared by random, reserved and auction selection. */
export function authorizeOperator(s: SelectionContext, actor: Actor): void {
  requireGroup(s.actorActive && (s.group.creatorType === "Platform" ? actor.isAdmin : s.group.createdByUserId === actor.userId),
    "NOT_AUTHORIZED_TO_EXECUTE_SELECTION", "Only the owning approved organizer or platform administrator can execute selection.");
  requireGroup(s.group.creatorType !== "Organizer" || s.organizerApproved, "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
  requireRule(s.group.status !== "Suspended", "GROUP_SUSPENDED", "Selection is blocked while the group is suspended.");
  requireRule(s.group.status === "Active", "GROUP_NOT_ACTIVE", "Only active groups can execute selection.");
}

export function authorizeReader(s: SelectionContext, actor: Actor): void {
  requireGroup(s.actorActive && (actor.isAdmin || (s.group.creatorType === "Organizer" && s.group.createdByUserId === actor.userId) ||
    s.participants.some((p) => p.membership.userId === actor.userId && ["Active", "Approved", "Completed"].includes(p.membership.status))),
    "MEMBERSHIP_REQUIRED", "Selection results are available only to group members, the organizer, and administrators.");
}

/** Razorpay groups count captured money; manual groups count recorded tracking. */
const satisfied = (s: SelectionContext, c: Contribution) =>
  (s.group.rules.collectionMode === "Razorpay" ? c.financiallySettledAmount : c.recordedAmount).eq(c.expectedAmount);

/** Active, slotted, not-yet-selected members of an active user account whose contribution for this cycle is complete. */
export function eligible(s: SelectionContext): SelectionParticipant[] {
  const paid = new Set(s.contributions.filter((c) => c.groupId === s.group.id && c.cycleId === s.cycle.id && satisfied(s, c)).map((c) => c.membershipId));
  return s.participants.filter((p) => p.userActive && p.membership.groupId === s.group.id && p.membership.status === "Active" && !p.membership.hasBeenSelectedForPayout &&
    p.membership.slotNumber !== null && p.membership.slotNumber >= 1 && p.membership.slotNumber <= s.group.memberLimit && paid.has(p.membership.id))
    .sort((a, b) => (a.membership.slotNumber ?? 0) - (b.membership.slotNumber ?? 0));
}

export function requireReady(s: SelectionContext): void {
  requireRule(s.cycle.selectionMethod !== "Auction", "AUCTION_SELECTION_NOT_SUPPORTED_HERE", "Use the auction endpoints for auction selection.");
  requireRule(s.cycle.selectionMethod === "Random" || s.cycle.selectionMethod === "OrganizerReserved", "SELECTION_METHOD_NOT_SUPPORTED", "This selection method is unsupported.");
  requireContributionsReady(s);
}

export function requireContributionsReady(s: SelectionContext): void {
  const c = s.cycle;
  requireRule(c.status === "ReadyForSelection" && c.cycleNumber === s.group.currentCycleNumber && c.selectionResultId === null,
    "CYCLE_NOT_READY_FOR_SELECTION", "The current cycle must be ready for selection.");
  const obligations = s.contributions;
  const totalsComplete = s.group.rules.collectionMode === "Razorpay"
    ? c.financiallySettledMemberCount === c.expectedMemberCount && c.financiallySettledAmount.eq(c.expectedPoolAmount)
    : c.fullyRecordedMemberCount === c.expectedMemberCount && c.recordedContributionAmount.eq(c.expectedPoolAmount);
  requireRule(c.expectedMemberCount === s.group.memberLimit && c.expectedContributionPerMember.eq(s.group.monthlyContribution) && c.expectedPoolAmount.eq(s.group.groupValue) &&
    totalsComplete && obligations.length === c.expectedMemberCount && new Set(obligations.map((o) => o.membershipId)).size === c.expectedMemberCount &&
    obligations.every((o) => o.groupId === s.group.id && o.cycleId === c.id && o.expectedAmount.eq(c.expectedContributionPerMember) && satisfied(s, o)),
    "CYCLE_NOT_READY_FOR_SELECTION", "Every expected contribution and the cycle totals must still be fully recorded.");
}

/** Organizer-first payout: cycle 1 goes to the participating organizer (ORGANIZER_RESERVED). */
export function reservedOrganizer(s: SelectionContext): SelectionParticipant {
  requireRule(s.group.creatorType === "Organizer" && s.group.rules.organizerFirstPayout && s.group.rules.organizerParticipates && s.cycle.cycleNumber === 1,
    "INVALID_ORGANIZER_RESERVED_CYCLE", "Published organizer reservation is required and applies only to cycle 1.");
  const organizer = s.participants.find((p) => p.membership.userId === s.group.createdByUserId && p.membership.groupId === s.group.id);
  requireRule(organizer !== undefined, "ORGANIZER_MEMBERSHIP_NOT_FOUND", "The participating organizer membership was not found.");
  requireRule(!organizer.membership.hasBeenSelectedForPayout, "ORGANIZER_ALREADY_SELECTED", "The organizer already owns a payout right.");
  requireRule(eligible(s).some((p) => p.membership.id === organizer.membership.id), "ORGANIZER_MEMBERSHIP_NOT_ELIGIBLE", "Organizer membership must be active, valid, and fully recorded.");
  return organizer;
}
