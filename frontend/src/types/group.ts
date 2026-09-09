export interface AuctionRules {
  minimumDiscount: number;
  maximumDiscount: number;
  bidIncrement: number;
  auctionStartTime: string;
  auctionEndTime: string;
}
export interface GroupInput {
  name: string;
  description: string;
  groupType: "RANDOM" | "AUCTION";
  groupValue: number;
  memberLimit: number;
  organizerParticipates: boolean;
  organizerFirstPayout: boolean;
  contributionDueDay: number;
  selectionDay: number;
  payoutDay: number;
  startDate: string;
  auctionRules?: AuctionRules | null;
}
export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  slotNumber: number | null;
  status: string;
  appliedAt: string;
  approvedAt: string | null;
  termsVersionId: string | null;
  termsAcceptedAt: string | null;
  rejectedReason: string | null;
  hasBeenSelectedForPayout: boolean;
  payoutCycleNumber: number | null;
}
export interface Group extends GroupInput {
  id: string;
  creatorType: "PLATFORM" | "ORGANIZER";
  currentMemberCount: number;
  availableSlots: number;
  monthlyContribution: number;
  durationMonths: number;
  status: string;
  rulesVersion: number;
  rulesLocked: boolean;
  firstCycleSelectionMethod: string;
  pendingApplications: number;
  organizer: {
    name: string;
    verified: boolean;
    status: string;
    memberSince: string;
  } | null;
  currentRules: {
    id: string;
    rulesHash: string;
    rulesSnapshot: string;
    versionNumber: number;
  } | null;
  myMembership: Member | null;
  statusReason: string | null;
  groupTimeZone: string;
  activatedAt: string | null;
  currentCycleNumber: number | null;
}
export interface GroupPage {
  items: Group[];
  page: number;
  pageSize: number;
  totalCount: number;
}
