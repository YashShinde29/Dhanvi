import type { Queryable } from "../../infra/database/db.js";
import { NotFoundError } from "../../utils/errors.js";
import { authRepository } from "../auth/auth.repository.js";
import { type Contribution } from "../contribution/contribution.domain.js";
import type { MonthlyCycle } from "../cycle/cycle.domain.js";
import { cycleRepository } from "../cycle/cycle.repository.js";
import { groupRepository } from "../group/group.repository.js";
import type { Group, Membership, SelectionMethod } from "../group/group.types.js";
import { organizerRepository } from "../organizer/organizer.repository.js";

export interface SelectionParticipant { membership: Membership; userActive: boolean; displayName: string }

export interface SelectionResult {
  id: string; groupId: string; cycleId: string; cycleNumber: number; selectionMethod: SelectionMethod; winnerMembershipId: string; winnerUserId: string;
  winnerSlotNumber: number; eligibleMemberCount: number; executedAt: Date; executedByUserId: string; algorithmVersion: string; randomSourceType: string | null;
  seedCommitment: string | null; seedReveal: string | null; eligibleSetHash: string | null; resultHash: string; selectedIndex: number | null;
  eligibleMembers: Array<{ membershipId: string; slotNumber: number; ordinal: number }>;
}

/** SelectionContext — everything selection and auction rules read, loaded inside the caller's transaction. */
export interface SelectionContext {
  group: Group;
  cycle: MonthlyCycle;
  participants: SelectionParticipant[];
  contributions: Contribution[];
  organizerApproved: boolean;
  actorActive: boolean;
  existingResult: SelectionResult | null;
}

/** "Asha R." — first name plus last initial; members never see full identities of others. */
export function displayName(name: string | undefined): string {
  const parts = name?.split(" ").filter(Boolean) ?? [];
  if (parts.length === 0) return "Unavailable member";
  return parts[0] + (parts.length > 1 ? ` ${(parts[parts.length - 1] as string)[0]}.` : "");
}

export async function selectionResultFor(db: Queryable, groupId: string, cycleId: string): Promise<SelectionResult | null> {
  const r = await db.maybeOne<Record<string, unknown>>(`SELECT * FROM groups."SelectionResults" WHERE "CycleId" = $1 AND "GroupId" = $2`, [cycleId, groupId]);
  if (!r) return null;
  const eligible = await db.query<{ MembershipId: string; SlotNumber: number; Ordinal: number }>(
    `SELECT "MembershipId","SlotNumber","Ordinal" FROM groups."SelectionEligibleMembers" WHERE "SelectionResultId" = $1 ORDER BY "Ordinal"`, [r.Id]);
  return {
    id: r.Id as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, cycleNumber: r.CycleNumber as number, selectionMethod: r.SelectionMethod as SelectionMethod,
    winnerMembershipId: r.WinnerMembershipId as string, winnerUserId: r.WinnerUserId as string, winnerSlotNumber: r.WinnerSlotNumber as number,
    eligibleMemberCount: r.EligibleMemberCount as number, executedAt: r.ExecutedAt as Date, executedByUserId: r.ExecutedByUserId as string, algorithmVersion: r.AlgorithmVersion as string,
    randomSourceType: r.RandomSourceType as string | null, seedCommitment: r.SeedCommitment as string | null, seedReveal: r.SeedReveal as string | null,
    eligibleSetHash: r.EligibleSetHash as string | null, resultHash: r.ResultHash as string, selectedIndex: r.SelectedIndex as number | null,
    eligibleMembers: eligible.map((e) => ({ membershipId: e.MembershipId, slotNumber: e.SlotNumber, ordinal: e.Ordinal })),
  };
}

/**
 * SelectionStore.Load. With `lock`, the group row is taken FOR UPDATE first (callers that also lock the cycle and
 * auction do so in the same group → cycle → auction order everywhere, so no lock-order deadlocks).
 */
export async function loadSelectionContext(db: Queryable, groupId: string, cycleId: string, actorId: string | null, lock: boolean): Promise<SelectionContext> {
  const group = lock ? await groupRepository.lock(db, groupId) : await groupRepository.find(db, groupId);
  if (!group) throw new NotFoundError("Group not found.");
  const cycle = await cycleRepository.cycle(db, groupId, cycleId, lock);
  if (!cycle) throw new NotFoundError("Cycle not found in this group.");
  const members = await groupRepository.memberships(db, groupId, lock);
  const users = await authRepository.directoryMany(db, members.map((m) => m.userId));
  return {
    group, cycle,
    participants: members.map((m) => ({ membership: m, userActive: users.has(m.userId), displayName: displayName(users.get(m.userId)?.name) })),
    contributions: await cycleRepository.contributions(db, { groupId, cycleId }, lock),
    organizerApproved: group.creatorType === "Platform" || (await organizerRepository.isApproved(db, group.createdByUserId)),
    actorActive: actorId !== null && (await authRepository.directory(db, actorId)) !== null,
    existingResult: await selectionResultFor(db, groupId, cycleId),
  };
}

export async function insertSelectionResult(db: Queryable, r: SelectionResult): Promise<void> {
  await db.execute(`INSERT INTO groups."SelectionResults" ("Id","GroupId","CycleId","CycleNumber","SelectionMethod","WinnerMembershipId","WinnerUserId","WinnerSlotNumber",
    "EligibleMemberCount","ExecutedAt","ExecutedByUserId","AlgorithmVersion","RandomSourceType","SeedCommitment","SeedReveal","EligibleSetHash","ResultHash","SelectedIndex")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [r.id, r.groupId, r.cycleId, r.cycleNumber, r.selectionMethod, r.winnerMembershipId, r.winnerUserId, r.winnerSlotNumber, r.eligibleMemberCount, r.executedAt, r.executedByUserId,
      r.algorithmVersion, r.randomSourceType, r.seedCommitment, r.seedReveal, r.eligibleSetHash, r.resultHash, r.selectedIndex]);
  for (const e of r.eligibleMembers)
    await db.execute(`INSERT INTO groups."SelectionEligibleMembers" ("SelectionResultId","MembershipId","GroupId","SlotNumber","Ordinal") VALUES ($1,$2,$3,$4,$5)`,
      [r.id, e.membershipId, r.groupId, e.slotNumber, e.ordinal]);
}
