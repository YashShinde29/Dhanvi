import type { SelectionResult } from "./selection";

export interface AuctionBid {
  bidId: string;
  discountAmount: number;
  sequenceNumber: number;
  isCurrentWinningBid: boolean;
  currentHighestDiscount: number;
  potentialWinnerPayout: number;
  submittedAt: string;
  memberSlot: number | null;
}
export interface AuctionResult {
  id: string;
  winningBidId: string;
  winner: SelectionResult["winner"];
  groupValue: number;
  winningDiscount: number;
  winnerPayout: number;
  grossMemberShare: number;
  platformFee: number;
  memberBenefitPool: number;
  nonWinnerCount: number;
  feePolicy: string;
  calculationVersion: string;
  finalizedAt: string;
  myBenefitAllocation: number | null;
  allocations: { membershipId: string | null; allocationType: string; amount: number }[];
  allocationStatus: string;
}
export interface Auction {
  id: string | null;
  cycleNumber: number;
  status: "SCHEDULED" | "OPEN" | "CLOSED" | "WINNER_SELECTED" | "CLOSED_NO_BIDS";
  startsAt: string;
  endsAt: string;
  serverTime: string;
  openedAt: string | null;
  closedAt: string | null;
  winnerSelectedAt: string | null;
  minimumDiscount: number;
  maximumDiscount: number;
  bidIncrement: number;
  currentHighestDiscount: number;
  minimumNextBid: number;
  potentialWinnerPayout: number;
  bidCount: number;
  eligibleBidderCount: number;
  canManage: boolean;
  canOpen: boolean;
  canClose: boolean;
  canBid: boolean;
  bidUnavailableReason: string | null;
  myBids: AuctionBid[];
  operationalBids: AuctionBid[];
  auditHistory: { action: string; createdAt: string; subjectId: string | null }[];
  result: AuctionResult | null;
  /** Group facts and live movement for the dedicated auction screen (no identities beyond member position). */
  groupValue: number;
  groupName: string;
  durationMonths: number;
  recentBids: AuctionActivity[];
  currentLeaderSlot: number | null;
  /** Latest-change summary only (denormalized on the auction). Full history is a separate paged call. */
  wasRescheduled: boolean;
  lastRescheduledAt: string | null;
  rescheduleCount: number;
  originalStartsAt: string | null;
  originalEndsAt: string | null;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  latestReasonCode: AuctionScheduleReason | null;
  latestMemberMessage: string | null;
  canReschedule: boolean;
  rescheduleUnavailableReason: string | null;
  /** Concurrency token the operator saw; sent back as expectedScheduleVersion so a stale screen cannot overwrite. */
  scheduleVersion: number;
  /**
   * Digital closing sequence (server-authoritative). null while bidding normally inside the window.
   * GOING_ONCE / GOING_TWICE / FINAL_WARNING accept higher bids (which reset to GOING_ONCE); FINALIZING does not.
   */
  closingState?: AuctionClosingState | null;
  closingPhaseEndsAt?: string | null;
  closingVersion?: number;
  closingStartedAt?: string | null;
  closingDurations?: { goingOnceSeconds: number; goingTwiceSeconds: number; finalWarningSeconds: number };
}
export type AuctionClosingState = "GOING_ONCE" | "GOING_TWICE" | "FINAL_WARNING" | "FINALIZING" | "COMPLETED";
export type AuctionScheduleReason = "PUBLIC_HOLIDAY" | "TECHNICAL_ISSUE" | "OPERATIONAL_ISSUE" | "ORGANIZER_REQUEST" | "INCORRECT_SCHEDULE" | "MEMBER_AVAILABILITY" | "EMERGENCY" | "OTHER";
/** One history row. reasonText, changedByRole and changedByName are null for members. */
export interface AuctionScheduleChange { id: string; cycleId: string; cycleNumber: number; changeSequence: number; previousStartsAt: string; previousEndsAt: string; newStartsAt: string; newEndsAt: string; reasonCode: AuctionScheduleReason; reasonText: string | null; memberMessage: string | null; changedByRole: "ADMIN" | "ORGANIZER" | null; changedByName: string | null; changedAt: string }
export interface AuctionScheduleHistoryPage { items: AuctionScheduleChange[]; page: number; pageSize: number; totalCount: number }
export interface RescheduleAuctionInput { newStartsAt: string; newEndsAt: string; reasonCode: AuctionScheduleReason; reasonText: string | null; memberMessage: string | null; expectedScheduleVersion: number }
export interface AuctionActivity { discountAmount: number; submittedAt: string; memberSlot: number; isMine: boolean; isCurrentHighest: boolean }
