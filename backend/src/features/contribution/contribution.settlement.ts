import type { Queryable } from "../../infra/database/db.js";
import { NotFoundError, requireRule } from "../../utils/errors.js";
import type { Decimal } from "../../utils/money.js";
import { sum } from "../../utils/money.js";
import { writeGroupAudit } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { recalculateFinancial } from "../cycle/cycle.domain.js";
import { cycleRepository } from "../cycle/cycle.repository.js";
import { groupRepository } from "../group/group.repository.js";
import { refund, settle } from "./contribution.domain.js";

export interface ContributionPaymentSource {
  contributionId: string; groupId: string; cycleId: string; membershipId: string; userId: string; groupName: string; memberName: string; cycleNumber: number;
  timeZone: string; expectedAmount: Decimal; settledAmount: Decimal; financialStatus: string; collectionMode: string; canCollect: boolean; selectionCompleted: boolean;
}

/**
 * IContributionSettlementService.ReadLockedAsync — takes the group row lock (the same lock every group mutation uses)
 * and reports whether gateway collection is currently allowed for this obligation.
 */
export async function readContributionLocked(db: Queryable, contributionId: string): Promise<ContributionPaymentSource> {
  const head = await db.maybeOne<{ GroupId: string }>(`SELECT "GroupId" FROM groups."Contributions" WHERE "Id" = $1`, [contributionId]);
  if (!head) throw new NotFoundError("Contribution not found.");
  const group = (await groupRepository.lock(db, head.GroupId))!;
  const contribution = (await cycleRepository.contribution(db, contributionId, true))!;
  const cycle = (await cycleRepository.cycleById(db, contribution.cycleId))!;
  const member = (await groupRepository.membershipsByIds(db, [contribution.membershipId])).get(contribution.membershipId)!;
  const user = await authRepository.directory(db, member.userId);
  const canCollect = group.rules.collectionMode === "Razorpay" && group.creatorType === "Platform" && group.status === "Active" && cycle.status === "CollectingContributions" &&
    cycle.cycleNumber === group.currentCycleNumber && member.status === "Active" && user !== null && contribution.financiallySettledAmount.lt(contribution.expectedAmount);
  return {
    contributionId, groupId: group.id, cycleId: cycle.id, membershipId: member.id, userId: member.userId, groupName: group.name, memberName: user?.name ?? "Member",
    cycleNumber: cycle.cycleNumber, timeZone: group.groupTimeZone, expectedAmount: contribution.expectedAmount, settledAmount: contribution.financiallySettledAmount,
    financialStatus: contribution.financialStatus, collectionMode: group.rules.collectionMode, canCollect,
    selectionCompleted: cycle.selectionResultId !== null || !["CollectingContributions", "ReadyForSelection", "ContributionsComplete"].includes(cycle.status),
  };
}

/** Settle (capture) or reverse (refund) the financial obligation and recompute cycle readiness atomically. */
export async function applyContributionSettlement(db: Queryable, contributionId: string, paymentId: string, amount: Decimal | null, now: Date): Promise<void> {
  const source = await readContributionLocked(db, contributionId);
  requireRule(source.collectionMode === "Razorpay" && !source.selectionCompleted, "SETTLEMENT_REVIEW_REQUIRED", "Settlement correction requires an unselected Razorpay cycle.");
  const c = (await cycleRepository.contribution(db, contributionId, true))!;
  const before = cycleRepository.contributionSnapshot(c);
  const reverse = amount === null;
  if (reverse) refund(c, paymentId, now); else settle(c, paymentId, amount, now);
  await cycleRepository.saveContribution(db, c, before);
  const all = await cycleRepository.contributions(db, { cycleId: c.cycleId });
  const cycle = (await cycleRepository.cycleById(db, c.cycleId))!;
  const cycleBefore = cycleRepository.cycleSnapshot(cycle);
  const ready = recalculateFinancial(cycle, sum(all.map((x) => x.financiallySettledAmount)), all.filter((x) => x.financiallySettledAmount.eq(x.expectedAmount)).length, all.length, now);
  await cycleRepository.saveCycle(db, cycle, cycleBefore);
  await writeGroupAudit(db, { groupId: c.groupId, actorUserId: source.userId, action: reverse ? "CONTRIBUTION_SETTLEMENT_REVERSED" : "CONTRIBUTION_FINANCIALLY_SETTLED", createdAt: now, subjectId: contributionId });
  if (ready || reverse) await writeGroupAudit(db, { groupId: c.groupId, actorUserId: source.userId, action: ready ? "CYCLE_READY_FOR_SELECTION" : "CYCLE_FINANCIAL_SHORTFALL_REOPENED", createdAt: now, subjectId: c.cycleId });
}
