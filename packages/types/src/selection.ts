export interface SelectionResult {
  id: string;
  groupId: string;
  cycleId: string;
  cycleNumber: number;
  selectionMethod: string;
  winner: { membershipId: string; slotNumber: number; displayName: string };
  eligibleMemberCount: number;
  executedAt: string;
  algorithmVersion: string;
  verificationAvailable: boolean;
}
export interface DrawProof {
  algorithmVersion: string;
  groupId: string;
  cycleId: string;
  cycleNumber: number;
  canonicalEligibleMembers: { membershipId: string; slotNumber: number }[];
  eligibleSetHash: string;
  seedCommitment: string;
  seedReveal: string;
  selectedIndex: number;
  winnerMembershipId: string;
  resultHash: string;
}
export interface SelectionVerification {
  selectionResultId: string;
  valid: boolean;
  failureReason: string | null;
  proof: DrawProof;
}
