import type { Queryable } from "../../infra/database/db.js";
import { NotFoundError, requireRule } from "../../utils/errors.js";
import { writeGroupAudit } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { advanceCycle, complete } from "../group/group.domain.js";
import { groupRepository } from "../group/group.repository.js";
import { completeSettlement, openNext } from "./cycle.domain.js";
import { cycleRepository } from "./cycle.repository.js";

export interface SettlementCycle {
  groupId: string; groupName: string; ownerId: string; organizerCreated: boolean; active: boolean; cycleId: string; cycleNumber: number; status: string;
  selectionResultId: string | null; selectionMethod: string; recipients: Array<{ membershipId: string; userId: string; name: string }>;
}

/** ICycleSettlementStore.ReadLockedAsync — locks the cycle's group row. */
export async function readSettlementCycle(db: Queryable, cycleId: string): Promise<SettlementCycle> {
  const head = await db.maybeOne<{ GroupId: string }>(`SELECT "GroupId" FROM groups."MonthlyCycles" WHERE "Id" = $1`, [cycleId]);
  if (!head) throw new NotFoundError("Cycle not found.");
  const g = (await groupRepository.lock(db, head.GroupId))!;
  const c = (await cycleRepository.cycleById(db, cycleId))!;
  const members = (await groupRepository.memberships(db, g.id)).filter((m) => m.slotNumber !== null);
  const users = await authRepository.directoryMany(db, members.map((m) => m.userId));
  return {
    groupId: g.id, groupName: g.name, ownerId: g.createdByUserId, organizerCreated: g.creatorType === "Organizer", active: g.status === "Active", cycleId: c.id,
    cycleNumber: c.cycleNumber, status: c.status, selectionResultId: c.selectionResultId, selectionMethod: c.selectionMethod,
    recipients: members.map((m) => ({ membershipId: m.id, userId: m.userId, name: users.get(m.userId)?.name ?? "Member" })),
  };
}

export async function canInspectGroup(db: Queryable, groupId: string, actor: string): Promise<boolean> {
  return (await db.maybeOne(`SELECT 1 FROM groups."Groups" WHERE "Id" = $1 AND "CreatorType" = 'Organizer' AND "CreatedByUserId" = $2`, [groupId, actor])) !== null;
}

/**
 * CompleteAndOpenNextAsync — after every allocation of the cycle has settled: complete the cycle, then open the next
 * one, or complete the group after its final cycle (each member selected exactly once). Deferred triggers re-verify.
 */
export async function completeCycleAndOpenNext(db: Queryable, cycleId: string, actor: string, now: Date): Promise<void> {
  const source = await readSettlementCycle(db, cycleId);
  if (source.status === "Completed") return;
  requireRule(source.active, "PAYOUT_GROUP_SUSPENDED", "Group must be active to complete a cycle.");
  const group = (await groupRepository.find(db, source.groupId))!;
  const groupBefore = groupRepository.groupSnapshot(group);
  const cycles = await cycleRepository.cycles(db, group.id);
  const current = cycles.find((c) => c.id === cycleId)!;
  requireRule(group.currentCycleNumber === current.cycleNumber && cycles.length === group.durationMonths, "NEXT_CYCLE_NOT_ALLOWED", "Cycle schedule is inconsistent.");
  const currentBefore = cycleRepository.cycleSnapshot(current);
  completeSettlement(current, now);
  const audit = (action: string, cycle: string = cycleId) => writeGroupAudit(db, { groupId: group.id, actorUserId: actor, action, createdAt: now, cycleId: cycle });
  await cycleRepository.saveCycle(db, current, currentBefore);
  await audit("CYCLE_PAYOUTS_COMPLETED"); await audit("CYCLE_COMPLETED");
  const next = cycles.find((c) => c.cycleNumber === current.cycleNumber + 1);
  if (next) {
    requireRule(!cycles.some((c) => c.status === "CollectingContributions"), "NEXT_CYCLE_NOT_ALLOWED", "Another cycle is already collecting.");
    const nextBefore = cycleRepository.cycleSnapshot(next);
    openNext(next, now); advanceCycle(group, next.cycleNumber, now);
    await cycleRepository.saveCycle(db, next, nextBefore);
    await groupRepository.save(db, group, groupBefore);
    await audit("NEXT_CYCLE_OPENED", next.id);
  } else {
    const members = (await groupRepository.memberships(db, group.id)).filter((m) => m.slotNumber !== null);
    const selections = await db.query<{ WinnerMembershipId: string }>(`SELECT "WinnerMembershipId" FROM groups."SelectionResults" WHERE "GroupId" = $1`, [group.id]);
    requireRule(cycles.every((c) => c.id === current.id || c.status === "Completed") && members.length === group.memberLimit && selections.length === members.length &&
      members.every((m) => m.hasBeenSelectedForPayout && selections.filter((s) => s.WinnerMembershipId === m.id).length === 1),
      "CYCLE_SETTLEMENT_INCOMPLETE", "All cycles must be completed and every participating member selected exactly once.");
    complete(group, now);
    await groupRepository.save(db, group, groupBefore);
    await audit("GROUP_COMPLETED");
  }
}
