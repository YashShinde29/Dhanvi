/**
 * One place that maps backend enum values to display labels and visual tones.
 * Backend enum strings never change; only how they are presented.
 */
import { humanize } from "./format";

export type Tone = "neutral" | "info" | "indigo" | "warning" | "success" | "emerald" | "orange" | "danger";

export interface StatusPresentation { label: string; tone: Tone }

const groupStatus: Record<string, StatusPresentation> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PUBLISHED: { label: "Published", tone: "info" },
  RECRUITING: { label: "Recruiting", tone: "info" },
  FULLY_SUBSCRIBED: { label: "Fully subscribed", tone: "indigo" },
  READY_TO_START: { label: "Ready to start", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  COMPLETING: { label: "Completing", tone: "emerald" },
  COMPLETED: { label: "Completed", tone: "emerald" },
  SUSPENDED: { label: "Suspended", tone: "orange" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

const cycleStatus: Record<string, StatusPresentation> = {
  UPCOMING: { label: "Upcoming", tone: "neutral" },
  COLLECTING_CONTRIBUTIONS: { label: "Collecting contributions", tone: "info" },
  CONTRIBUTIONS_COMPLETE: { label: "Contributions complete", tone: "indigo" },
  READY_FOR_SELECTION: { label: "Ready for selection", tone: "warning" },
  SELECTION_COMPLETED: { label: "Selection completed", tone: "success" },
  PAYOUT_PENDING: { label: "Payout pending", tone: "warning" },
  PAYOUT_COMPLETED: { label: "Payout completed", tone: "emerald" },
  COMPLETED: { label: "Completed", tone: "emerald" },
  SUSPENDED: { label: "Suspended", tone: "orange" },
};

const contributionStatus: Record<string, StatusPresentation> = {
  PENDING: { label: "Pending", tone: "neutral" },
  PARTIAL: { label: "Partial", tone: "warning" },
  RECORDED: { label: "Recorded", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  REVERSED: { label: "Reversed", tone: "orange" },
};

const membershipStatus: Record<string, StatusPresentation> = {
  APPLIED: { label: "Application submitted", tone: "info" },
  APPROVED: { label: "Approved", tone: "indigo" },
  ACTIVE: { label: "Active member", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "danger" },
  COMPLETED: { label: "Completed", tone: "emerald" },
};

const auctionStatus: Record<string, StatusPresentation> = {
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  OPEN: { label: "Open", tone: "success" },
  CLOSED: { label: "Closed", tone: "indigo" },
  WINNER_SELECTED: { label: "Completed", tone: "emerald" },
  CLOSED_NO_BIDS: { label: "Closed · no bids", tone: "orange" },
};

const organizerStatus: Record<string, StatusPresentation> = {
  NOT_APPLIED: { label: "Not applied", tone: "neutral" },
  PENDING: { label: "Pending review", tone: "info" },
  UNDER_REVIEW: { label: "Under review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  SUSPENDED: { label: "Suspended", tone: "orange" },
};

const selectionMethod: Record<string, StatusPresentation> = {
  RANDOM: { label: "Random draw", tone: "success" },
  AUCTION: { label: "Auction", tone: "indigo" },
  ORGANIZER_RESERVED: { label: "Organizer reserved", tone: "warning" },
};

export type StatusKind = "group" | "cycle" | "contribution" | "membership" | "auction" | "organizer" | "selection";

const catalog: Record<StatusKind, Record<string, StatusPresentation>> = {
  group: groupStatus, cycle: cycleStatus, contribution: contributionStatus, membership: membershipStatus,
  auction: auctionStatus, organizer: organizerStatus, selection: selectionMethod,
};

export function presentStatus(kind: StatusKind, value: string | null | undefined): StatusPresentation {
  if (!value) return { label: "—", tone: "neutral" };
  return catalog[kind][value] ?? { label: humanize(value), tone: "neutral" };
}

export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  return presentStatus(kind, value).label;
}

export const groupTypeLabel = (type: string) => (type === "AUCTION" ? "Auction" : type === "RANDOM" ? "Random" : humanize(type));

/** Statuses a member can browse and apply to. */
export const PUBLIC_GROUP_STATUSES = ["RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE", "COMPLETED"] as const;
export const ALL_GROUP_STATUSES = Object.keys(groupStatus);
export const ORGANIZER_APPLICATION_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export const CONTRIBUTION_STATUSES = Object.keys(contributionStatus);
