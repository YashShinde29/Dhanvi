/** Admin Control Center read models (GET /admin/operations/*, /admin/groups/operations, /admin/groups/{id}/operations-summary). */
export interface AdminCycleSnapshot {
  id: string; cycleNumber: number; status: string; selectionMethod: string; collectionMode: "MANUAL_TRACKING" | "RAZORPAY";
  contributionDueDate: string; selectionDate: string; payoutDate: string;
  expectedMemberCount: number; settledMemberCount: number; outstandingMemberCount: number; expectedPoolAmount: number; settledAmount: number;
  manualRecordedMemberCount: number; manualRecordedAmount: number;
  startedAt: string | null; readyForSelectionAt: string | null; selectionCompletedAt: string | null; completedAt: string | null;
  selectionResultId: string | null; winnerName: string | null; winnerSlotNumber: number | null;
  auctionStatus: string | null; auctionStartsAt: string | null; auctionEndsAt: string | null; auctionBidCount: number;
}
export interface AdminPaymentCounts { captured: number; pending: number; failed: number; reconciliationRequired: number; refunded: number }
export interface AdminPayoutCounts { pendingBeneficiary: number; approvalRequired: number; approved: number; processing: number; succeeded: number; failed: number; reconciliationRequired: number; cancelled: number }
export interface AdminGroupRow {
  id: string; name: string; creatorType: "PLATFORM" | "ORGANIZER"; groupType: "RANDOM" | "AUCTION"; collectionMode: "MANUAL_TRACKING" | "RAZORPAY";
  createdByUserId: string; organizerName: string | null; organizerStatus: string | null;
  groupValue: number; monthlyContribution: number; memberLimit: number; currentMemberCount: number; activeMemberCount: number; pendingApplications: number; termsPendingCount: number;
  status: string; statusReason: string | null; startDate: string; createdAt: string; activatedAt: string | null; durationMonths: number; currentCycleNumber: number | null;
  currentCycle: AdminCycleSnapshot | null; payments: AdminPaymentCounts; payouts: AdminPayoutCounts; lastActivityAt: string | null;
}
export interface AdminGroupPage { items: AdminGroupRow[]; page: number; pageSize: number; totalCount: number }
export interface AdminOutstandingContribution { contributionId: string; membershipId: string; memberName: string; slotNumber: number | null; expectedAmount: number; settledAmount: number; manualRecordedAmount: number; status: string; financialStatus: string; dueDate: string }
export interface AdminPayoutSnapshot { id: string; cycleId: string; cycleNumber: number; payoutType: string; membershipId: string | null; memberName: string; amount: number; status: string; hasBeneficiary: boolean; createdAt: string; approvedAt: string | null; settledAt: string | null }
export interface AdminPaymentSnapshot { id: string; cycleId: string; cycleNumber: number; memberName: string; amount: number; status: string; reconciliationStatus: string; reconciliationMessage: string | null; createdAt: string }
export type AdminIssueKind = "GROUP_SUSPENDED" | "PAYMENT_RECONCILIATION" | "PAYOUT_RECONCILIATION" | "PAYOUT_FAILED" | "MISSING_BENEFICIARY" | "AUCTION_NO_BIDS" | "OUTSTANDING_CONTRIBUTIONS";
export interface AdminGroupIssue { kind: AdminIssueKind; title: string; detail: string; responsibleRole: "USER" | "ORGANIZER" | "ADMIN" | "FINANCE" | "SYSTEM"; since: string | null; referenceType: string | null; referenceId: string | null }
export interface AdminActivityEntry { id: string; at: string; source: "GROUP" | "PAYOUT"; action: string; actorName: string | null; message: string | null; subjectId: string | null; cycleId: string | null }
export interface AdminGroupSummary {
  group: AdminGroupRow; cycles: AdminCycleSnapshot[]; outstandingContributions: AdminOutstandingContribution[]; payouts: AdminPayoutSnapshot[];
  paymentIssues: AdminPaymentSnapshot[]; issues: AdminGroupIssue[]; activity: AdminActivityEntry[];
}
export interface AttentionBucket { count: number; oldestSince: string | null }
export interface AdminOverview {
  groups: {
    total: number; draft: number; recruiting: number; fullySubscribed: number; readyToStart: number; active: number; completed: number; suspended: number; cancelled: number; activeMembers: number;
    platformReadyToActivate: AttentionBucket; platformReadyToConfirm: AttentionBucket; platformApplicationsPending: AttentionBucket; organizerGroupsAwaitingOrganizer: AttentionBucket; suspendedGroups: AttentionBucket;
    cyclesCollecting: number; cyclesOverdueCollecting: AttentionBucket; platformCyclesReadyForSelection: AttentionBucket; organizerCyclesReadyForSelection: AttentionBucket;
    cyclesSelectionCompleted: AttentionBucket; cyclesPayoutPending: number; auctionsOpen: AttentionBucket; auctionsClosedNoBids: AttentionBucket;
  };
  payments: { counts: AdminPaymentCounts; reconciliationRequired: AttentionBucket; pending: AttentionBucket };
  payouts: { counts: AdminPayoutCounts; approvalRequired: AttentionBucket; readyToExecute: AttentionBucket; failed: AttentionBucket; reconciliationRequired: AttentionBucket; pendingBeneficiary: AttentionBucket; processing: AttentionBucket };
  organizers: { applicationsPending: AttentionBucket; underReview: number; approved: number; suspended: number };
  generatedAt: string;
}
