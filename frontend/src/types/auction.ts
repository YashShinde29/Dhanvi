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
}
