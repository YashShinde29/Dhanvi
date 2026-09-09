export interface MonthlyCycle {
  id: string;
  groupId: string;
  cycleNumber: number;
  selectionMethod: string;
  status: string;
  contributionDueDate: string;
  selectionDate: string;
  payoutDate: string;
  groupTimeZone: string;
  expectedMemberCount: number;
  expectedContributionPerMember: number;
  expectedPoolAmount: number;
  recordedContributionAmount: number;
  fullyRecordedMemberCount: number;
  pendingMemberCount: number;
  startedAt: string | null;
  contributionsCompletedAt: string | null;
  readyForSelectionAt: string | null;
  selectionCompletedAt: string | null;
  selectionResultId: string | null;
}
export interface ContributionEntry {
  id: string;
  entryType: "RECORD" | "REVERSAL";
  amount: number;
  reference: string;
  note: string | null;
  recordedByUserId: string;
  createdAt: string;
  reversesEntryId: string | null;
}
export interface Contribution {
  id: string;
  groupId: string;
  groupName: string;
  cycleId: string;
  cycleNumber: number;
  membershipId: string;
  slotNumber: number | null;
  memberName: string | null;
  dueDate: string;
  groupTimeZone: string;
  expectedAmount: number;
  recordedAmount: number;
  status: string;
  recordedAt: string | null;
  entries: ContributionEntry[];
}
export interface ContributionPage {
  items: Contribution[];
  page: number;
  pageSize: number;
  totalCount: number;
}
