import type { DateOnly, TimeOnly } from "../../utils/dates.js";
import type { Decimal } from "../../utils/money.js";

// Enum names exactly as stored by EF (HasConversion<string>) and ordinals as serialized inside the Rules jsonb.
export const GROUP_TYPES = ["Random", "Auction"] as const;
export const COLLECTION_MODES = ["ManualTracking", "Razorpay"] as const;
export const CREATOR_TYPES = ["Platform", "Organizer"] as const;
export const GROUP_STATUSES = ["Draft", "Published", "Recruiting", "FullySubscribed", "ReadyToStart", "Active", "Completing", "Completed", "Suspended", "Cancelled"] as const;
export const MEMBERSHIP_STATUSES = ["Applied", "Approved", "Active", "Rejected", "Withdrawn", "Removed", "Completed"] as const;
export const SELECTION_METHODS = ["OrganizerReserved", "Random", "Auction"] as const;
export const AUCTION_FEE_POLICIES = ["WinnerMemberShare"] as const;

export type GroupType = (typeof GROUP_TYPES)[number];
export type CollectionMode = (typeof COLLECTION_MODES)[number];
export type CreatorType = (typeof CREATOR_TYPES)[number];
export type GroupStatus = (typeof GROUP_STATUSES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type SelectionMethod = (typeof SELECTION_METHODS)[number];
export type AuctionFeePolicy = (typeof AUCTION_FEE_POLICIES)[number];

export interface AuctionGroupRules {
  minimumDiscount: Decimal;
  maximumDiscount: Decimal;
  bidIncrement: Decimal;
  auctionStartTime: TimeOnly;
  auctionEndTime: TimeOnly;
  feePolicy: AuctionFeePolicy;
}

export interface RandomGroupRules { algorithmVersion: string; drawTime: TimeOnly | null; verificationMethod: string }

/** GroupConfiguration — the published, hash-locked rules. */
export interface GroupConfiguration {
  groupType: GroupType;
  groupValue: Decimal;
  memberLimit: number;
  organizerParticipates: boolean;
  organizerFirstPayout: boolean;
  contributionDueDay: number;
  selectionDay: number;
  payoutDay: number;
  startDate: DateOnly;
  auctionRules: AuctionGroupRules | null;
  randomRules: RandomGroupRules | null;
  collectionMode: CollectionMode;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  creatorType: CreatorType;
  createdByUserId: string;
  rules: GroupConfiguration;
  groupType: GroupType;
  groupValue: Decimal;
  memberLimit: number;
  monthlyContribution: Decimal;
  durationMonths: number;
  status: GroupStatus;
  currentMemberCount: number;
  rulesLocked: boolean;
  rulesVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  groupTimeZone: string;
  activatedAt: Date | null;
  currentCycleNumber: number | null;
  completedAt: Date | null;
  statusReason: string | null;
}

export interface Membership {
  id: string;
  groupId: string;
  userId: string;
  slotNumber: number | null;
  status: MembershipStatus;
  appliedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  termsVersionId: string | null;
  termsAcceptedAt: Date | null;
  updatedAt: Date;
  hasBeenSelectedForPayout: boolean;
  payoutCycleNumber: number | null;
}

export interface RuleVersion { id: string; groupId: string; versionNumber: number; rulesSnapshot: string; rulesHash: string; createdAt: Date; createdByUserId: string }

export interface GroupActor { userId: string; isAdmin: boolean }
