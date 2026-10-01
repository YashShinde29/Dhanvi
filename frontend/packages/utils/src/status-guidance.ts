/**
 * Backend enum → human guidance. One place for the description and the party that acts next, so pages
 * never hand-roll switch statements. `presentStatus` (status.ts) still owns the short label and tone.
 */
import { presentStatus, type StatusKind, type Tone } from "./status";
import { humanize } from "./format";

export type NextActor = "USER" | "ORGANIZER" | "ADMIN" | "FINANCE" | "SYSTEM" | "NONE";
export interface StatusGuidance { label: string; tone: Tone; /** Friendly stage name used in progress cards. */ stage: string; description: string; nextActor: NextActor; nextAction?: string }

type Catalog = Record<string, Omit<StatusGuidance, "label" | "tone">>;

const group: Catalog = {
  DRAFT: { stage: "Draft", description: "The group is saved but not visible to members yet.", nextActor: "ORGANIZER", nextAction: "Publish the group to start accepting applications." },
  PUBLISHED: { stage: "Published", description: "The rules are published and the group is about to accept members.", nextActor: "SYSTEM" },
  RECRUITING: { stage: "Accepting members", description: "Members can apply. Each approved member reserves one position.", nextActor: "ORGANIZER", nextAction: "Review applications until every position is filled." },
  FULLY_SUBSCRIBED: { stage: "Waiting to fill", description: "Every position is reserved. Approved members must accept the rules before the group can be confirmed.", nextActor: "ORGANIZER", nextAction: "Confirm the group is ready once all members have accepted the rules." },
  READY_TO_START: { stage: "Ready to start", description: "All members have accepted the rules. Activation creates the monthly schedule.", nextActor: "ORGANIZER", nextAction: "Activate the group." },
  ACTIVE: { stage: "Active", description: "The group runs one monthly cycle at a time.", nextActor: "USER", nextAction: "Contribute each cycle." },
  COMPLETING: { stage: "Completing", description: "The final cycle is settling.", nextActor: "SYSTEM" },
  COMPLETED: { stage: "Group completed", description: "All cycles have been completed. No further contributions are required.", nextActor: "NONE" },
  SUSPENDED: { stage: "Suspended", description: "Contribution records, selections and bids are paused by Dhanvi.", nextActor: "ADMIN" },
  CANCELLED: { stage: "Cancelled", description: "This group was cancelled and will not run.", nextActor: "NONE" },
};

const cycle: Catalog = {
  UPCOMING: { stage: "Upcoming", description: "This cycle has not started yet.", nextActor: "SYSTEM" },
  COLLECTING_CONTRIBUTIONS: { stage: "Collecting contributions", description: "Members are paying this month's contribution.", nextActor: "USER", nextAction: "Pay your contribution." },
  CONTRIBUTIONS_COMPLETE: { stage: "Contributions complete", description: "Every contribution is recorded.", nextActor: "SYSTEM" },
  READY_FOR_SELECTION: { stage: "Ready for selection", description: "All contributions are complete. The selection can run.", nextActor: "ORGANIZER", nextAction: "Start the selection or auction." },
  SELECTION_COMPLETED: { stage: "Selection completed", description: "The payout recipient for this cycle is recorded.", nextActor: "ADMIN", nextAction: "Prepare the payout settlement." },
  PAYOUT_PENDING: { stage: "Payout processing", description: "The payout is being prepared and processed.", nextActor: "FINANCE" },
  PAYOUT_COMPLETED: { stage: "Payout completed", description: "The payout for this cycle was settled.", nextActor: "SYSTEM", nextAction: "The next cycle opens automatically." },
  COMPLETED: { stage: "Cycle completed", description: "This cycle is finished.", nextActor: "NONE" },
  SUSPENDED: { stage: "Suspended", description: "Paused by Dhanvi.", nextActor: "ADMIN" },
};

const membership: Catalog = {
  APPLIED: { stage: "Application submitted", description: "Waiting for the organizer to review your application.", nextActor: "ORGANIZER", nextAction: "Organizer reviews your application." },
  APPROVED: { stage: "Approved", description: "Your application was approved. Review and accept the group rules.", nextActor: "USER", nextAction: "Review and accept the group rules." },
  ACTIVE: { stage: "Active member", description: "You contribute each cycle and receive your payout turn once.", nextActor: "USER" },
  REJECTED: { stage: "Not approved", description: "The organizer did not approve this application.", nextActor: "NONE" },
  WITHDRAWN: { stage: "Withdrawn", description: "You withdrew from this group.", nextActor: "NONE" },
  REMOVED: { stage: "Removed", description: "You are no longer part of this group.", nextActor: "NONE" },
  COMPLETED: { stage: "Completed", description: "The group finished all its cycles.", nextActor: "NONE" },
};

const organizer: Catalog = {
  NOT_APPLIED: { stage: "Not applied", description: "You have not applied to become an organizer.", nextActor: "USER", nextAction: "Submit an organizer application." },
  PENDING: { stage: "Application submitted", description: "Your organizer application is waiting for review.", nextActor: "ADMIN", nextAction: "Dhanvi reviews your application." },
  UNDER_REVIEW: { stage: "Under review", description: "A Dhanvi administrator is reviewing your application.", nextActor: "ADMIN" },
  APPROVED: { stage: "Approved", description: "You can create and manage savings groups.", nextActor: "USER", nextAction: "Create your first group." },
  REJECTED: { stage: "Not approved", description: "Your application was not approved. You may apply again.", nextActor: "USER" },
  SUSPENDED: { stage: "Suspended", description: "Organizer access is suspended by Dhanvi.", nextActor: "ADMIN" },
};

const auction: Catalog = {
  SCHEDULED: { stage: "Auction scheduled", description: "The auction has not opened yet.", nextActor: "ORGANIZER", nextAction: "Organizer opens the auction at the scheduled time." },
  OPEN: { stage: "Auction open", description: "Eligible members can place discount bids.", nextActor: "USER", nextAction: "Place a bid." },
  CLOSED: { stage: "Auction closed", description: "Bidding has ended; the result is being finalised.", nextActor: "SYSTEM" },
  WINNER_SELECTED: { stage: "Auction completed", description: "The winning discount decided this cycle's payout right.", nextActor: "ADMIN", nextAction: "Payout processing." },
  CLOSED_NO_BIDS: { stage: "Closed without bids", description: "No winner was assigned. The cycle needs organizer review.", nextActor: "ORGANIZER" },
};

const payment: Catalog = {
  PENDING: { stage: "Payment pending", description: "No verified payment yet.", nextActor: "USER", nextAction: "Pay the contribution." },
  AUTHORIZED: { stage: "Verifying payment", description: "The provider authorised the payment; capture is being confirmed. Do not pay again.", nextActor: "SYSTEM" },
  CAPTURED: { stage: "Payment confirmed", description: "The contribution is settled.", nextActor: "NONE" },
  FAILED: { stage: "Payment failed", description: "The contribution has not been settled.", nextActor: "USER", nextAction: "Try the payment again." },
  REFUND_PENDING: { stage: "Refund in progress", description: "A refund was requested; settlement stays until it is confirmed.", nextActor: "SYSTEM" },
  REFUNDED: { stage: "Refunded", description: "The payment was refunded and the contribution reopened.", nextActor: "USER", nextAction: "Pay the contribution again." },
  RECONCILIATION_REQUIRED: { stage: "Needs reconciliation", description: "Provider data did not match. Dhanvi must review before anything changes.", nextActor: "FINANCE", nextAction: "Review and reconcile." },
};

const payout: Catalog = {
  PENDING_BENEFICIARY: { stage: "Awaiting bank account", description: "The recipient must add a payout bank account before approval.", nextActor: "USER", nextAction: "Add a payout bank account." },
  APPROVAL_REQUIRED: { stage: "Awaiting approval", description: "Funding and beneficiary are ready; an administrator must approve.", nextActor: "FINANCE", nextAction: "Approve the payout." },
  APPROVED: { stage: "Approved", description: "Approved and ready to execute.", nextActor: "FINANCE", nextAction: "Execute the payout." },
  PROCESSING: { stage: "Payout processing", description: "The transfer has been sent to the provider.", nextActor: "SYSTEM" },
  PROVIDER_PENDING: { stage: "Payout processing", description: "The payout provider is processing the transfer.", nextActor: "SYSTEM" },
  SUCCEEDED: { stage: "Payout completed", description: "The transfer succeeded.", nextActor: "NONE" },
  FAILED: { stage: "Payout failed", description: "The transfer failed. It can be retried by Dhanvi.", nextActor: "FINANCE", nextAction: "Retry the payout." },
  RECONCILIATION_REQUIRED: { stage: "Needs reconciliation", description: "Provider data did not match. Settlement and retries are blocked until reviewed.", nextActor: "FINANCE", nextAction: "Review the mismatch." },
  CANCELLED: { stage: "Cancelled", description: "This payout was cancelled.", nextActor: "NONE" },
};

const catalog = { group, cycle, membership, organizer, auction, payment, payout } as const;
export type GuidanceKind = keyof typeof catalog;

export function statusGuidance(kind: GuidanceKind, value: string | null | undefined): StatusGuidance {
  const presented = kind === "payment" || kind === "payout" ? { label: humanize(value ?? ""), tone: "neutral" as Tone } : presentStatus(kind as StatusKind, value);
  const entry = value ? catalog[kind][value] : undefined;
  return { label: presented.label, tone: presented.tone, stage: entry?.stage ?? presented.label, description: entry?.description ?? "", nextActor: entry?.nextActor ?? "NONE", nextAction: entry?.nextAction };
}

/** Short, friendly stage name for a status (e.g. READY_FOR_SELECTION → "Ready for selection"). */
export const stageName = (kind: GuidanceKind, value: string | null | undefined) => statusGuidance(kind, value).stage;
