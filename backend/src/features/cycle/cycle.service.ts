import type { GroupMemberPolicy } from "../../config/groups.js";
import type { Database, Queryable } from "../../infra/database/db.js";
import type { Clock, Page } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { newId, sha256HexUpper } from "../../utils/crypto.js";
import { businessToday, utcInstant } from "../../utils/dates.js";
import { netDecimal, netGuid, serializeNet } from "../../utils/dotnet-json.js";
import { snakeUpper } from "../../utils/enums.js";
import { NotFoundError, requireGroup, requireRule, UnauthorizedError } from "../../utils/errors.js";
import { findReceipt, insertReceipt, Scopes, validateReplay } from "../../utils/idempotency.js";
import type { Decimal } from "../../utils/money.js";
import { sum } from "../../utils/money.js";
import { writeGroupAudit } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { type Contribution, type ContributionEntry, type ContributionStatus, expectContribution, markOverdue, recordContribution, reverseContribution } from "../contribution/contribution.domain.js";
import * as groupDomain from "../group/group.domain.js";
import { groupRepository } from "../group/group.repository.js";
import type { Group, GroupActor } from "../group/group.types.js";
import type { LedgerPostingService } from "../ledger/ledger.posting.js";
import { organizerRepository } from "../organizer/organizer.repository.js";
import { ensureRecordingOpen, ensureReversalAllowed, generateSchedule, type MonthlyCycle, recalculate } from "./cycle.domain.js";
import { cycleRepository, mapContribution } from "./cycle.repository.js";

export interface RecordInput { amount: Decimal; amountToken: string; reference: string; note?: string | null }
export interface ReverseInput { entryId: string; reason: string }

/** Port of GroupCycleService: activation, cycle reads, manual contribution tracking. */
export class CycleService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly ledger: LedgerPostingService, private readonly policy: GroupMemberPolicy) {}

  /**
   * One transaction: activate the group, generate one cycle per member, create every member×cycle obligation,
   * activate memberships, write audit. Replays on an already-active group return the persisted schedule.
   */
  async activate(groupId: string, actor: GroupActor) {
    return this.db.transaction(async (tx) => {
      const group = await this.locked(tx, groupId);
      await this.manage(tx, group, actor);
      const existing = await cycleRepository.cycles(tx, groupId);
      if (group.status === "Active") {
        requireRule(existing.length === group.durationMonths && (await cycleRepository.contributionCount(tx, groupId)) === group.memberLimit * group.durationMonths,
          "INCOMPLETE_ACTIVATION", "The persisted schedule is inconsistent; administrative investigation is required.");
        return existing.map((c) => mapCycle(c, group.groupTimeZone));
      }
      const before = groupRepository.groupSnapshot(group);
      const members = (await groupRepository.memberships(tx, groupId, true)).filter((m) => m.status === "Approved");
      const rules = await groupRepository.ruleVersion(tx, groupId, group.rulesVersion);
      const accepted = rules ? (await tx.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."GroupTermsAcceptances" a JOIN groups."GroupMemberships" m ON m."Id" = a."MembershipId"
        WHERE a."GroupRuleVersionId" = $1 AND a."RulesHash" = $2 AND m."GroupId" = $3 AND m."Status" = 'Approved'`, [rules.id, rules.rulesHash, groupId])).count : 0;
      const allAccepted = rules !== null && accepted === members.length && members.every((m) => m.termsVersionId === rules.id && m.termsAcceptedAt !== null &&
        m.slotNumber !== null && m.slotNumber >= 1 && m.slotNumber <= group.memberLimit);
      const now = this.clock.now();
      groupDomain.activate(group, members.length, allAccepted, await this.organizerApproved(tx, group), existing.length !== 0, now, this.policy);
      const cycles = generateSchedule(group, now, newId);
      await groupRepository.save(tx, group, before);
      for (const c of cycles) await cycleRepository.insertCycle(tx, c);
      for (const m of members) {
        const mb = groupRepository.membershipSnapshot(m);
        groupDomain.activateMembership(m, now);
        await groupRepository.saveMembership(tx, m, mb);
        for (const c of cycles) await cycleRepository.insertContribution(tx, expectContribution(newId(), groupId, c.id, m.id, group.monthlyContribution, c.contributionDueDate, now));
      }
      for (const action of ["GROUP_ACTIVATED", "MONTHLY_CYCLES_CREATED", "CONTRIBUTIONS_CREATED"])
        await writeGroupAudit(tx, { groupId, actorUserId: actor.userId, action, createdAt: now });
      return cycles.map((c) => mapCycle(c, group.groupTimeZone));
    });
  }

  record(groupId: string, cycleId: string, contributionId: string, actor: GroupActor, key: string, input: RecordInput) {
    return this.operate(groupId, cycleId, contributionId, actor, key, input, null);
  }

  reverse(groupId: string, cycleId: string, contributionId: string, actor: GroupActor, key: string, input: ReverseInput) {
    return this.operate(groupId, cycleId, contributionId, actor, key, null, input);
  }

  private async operate(groupId: string, cycleId: string, contributionId: string, actor: GroupActor, rawKey: string, record: RecordInput | null, reversal: ReverseInput | null) {
    requireRule(!!rawKey && rawKey.trim().length > 0 && rawKey.length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send a non-empty Idempotency-Key header, maximum 200 characters.");
    const key = rawKey.trim();
    // Same request hash as .NET (uppercase SHA-256 of the default-options JSON), so pre-cutover receipts replay.
    const hash = sha256HexUpper(serializeNet({
      groupId: netGuid(groupId), cycleId: netGuid(cycleId), contributionId: netGuid(contributionId), UserId: netGuid(actor.userId),
      record: record && { Amount: netDecimal(record.amountToken), Reference: record.reference ?? null, Note: record.note ?? null },
      reversal: reversal && { EntryId: netGuid(reversal.entryId), Reason: reversal.reason ?? null },
    }));
    return this.db.transaction(async (tx) => {
      const group = await this.locked(tx, groupId);
      await this.manage(tx, group, actor);
      requireRule(group.status === "Active", "GROUP_NOT_ACTIVE", "Only active groups accept contribution recording or reversals.");
      const cycle = await cycleRepository.cycle(tx, groupId, cycleId);
      if (!cycle) throw new NotFoundError("Cycle not found in this group.");
      const contribution = await cycleRepository.contribution(tx, contributionId);
      if (!contribution || contribution.cycleId !== cycleId || contribution.groupId !== groupId) throw new NotFoundError("Contribution not found in this cycle.");
      const scope = Scopes.contribution(groupId);
      const receipt = await findReceipt(tx, scope, key);
      if (receipt) {
        validateReplay(receipt, hash);
        const result = await cycleRepository.entry(tx, receipt.resultId);
        if (!result || result.contributionId !== contributionId) throw new Error("Receipt result entry is missing.");
        return { entry: mapEntry(result), replayed: true };
      }
      const now = this.clock.now(); const today = businessToday(now, group.groupTimeZone);
      const cycleBefore = cycleRepository.cycleSnapshot(cycle);
      const contributionBefore = cycleRepository.contributionSnapshot(contribution);
      const audit = (action: string, subjectId: string) => writeGroupAudit(tx, { groupId, actorUserId: actor.userId, action, createdAt: now, subjectId });
      let entry: ContributionEntry;
      if (record) {
        ensureRecordingOpen(cycle);
        requireRule(!(await cycleRepository.referenceUsed(tx, contributionId, (record.reference ?? "").trim())), "REFERENCE_ALREADY_USED",
          "This manual reference already exists for the contribution. Retry with its original idempotency key or use a new reference.");
        entry = recordContribution(contribution, newId(), record.amount, record.reference, record.note, key, actor.userId, today, now);
        await audit(contribution.recordedAmount.eq(contribution.expectedAmount) ? "CONTRIBUTION_RECORDED" : "CONTRIBUTION_PARTIALLY_RECORDED", contributionId);
      } else {
        ensureReversalAllowed(cycle);
        const original = await cycleRepository.entry(tx, reversal!.entryId);
        if (!original || original.contributionId !== contributionId) throw new NotFoundError("Original contribution entry not found.");
        entry = reverseContribution(contribution, newId(), original, reversal!.reason, key, actor.userId, await cycleRepository.isReversed(tx, original.id), today, now);
        await audit("CONTRIBUTION_REVERSED", contributionId);
      }
      await cycleRepository.saveContribution(tx, contribution, contributionBefore);
      await cycleRepository.insertEntry(tx, entry);
      await insertReceipt(tx, { id: newId(), scope, key, requestHash: hash, resultId: entry.id, createdAt: now });
      const all = await cycleRepository.contributions(tx, { cycleId });
      const wasReady = cycle.status === "ReadyForSelection";
      if (recalculate(cycle, sum(all.map((c) => c.recordedAmount)), all.filter((c) => c.recordedAmount.eq(c.expectedAmount)).length, all.length, now)) {
        await audit("CYCLE_CONTRIBUTIONS_COMPLETED", cycleId); await audit("CYCLE_READY_FOR_SELECTION", cycleId);
      } else if (wasReady) await audit("CYCLE_REOPENED_AFTER_REVERSAL", cycleId);
      if (contribution.status === "Overdue") await audit("CONTRIBUTION_MARKED_OVERDUE", contributionId);
      await cycleRepository.saveCycle(tx, cycle, cycleBefore);
      // Manual tracking is not a payment: the ledger records nothing (DEFERRED / MANUAL_CONTRIBUTION_IS_NOT_PAYMENT).
      await this.ledger.post(tx, record ? "ContributionRecorded" : "ContributionReversed", entry.id, actor.userId);
      return { entry: mapEntry(entry), replayed: false };
    });
  }

  async markOverdue(groupId: string, actor: GroupActor): Promise<number> {
    return this.db.transaction(async (tx) => {
      const group = await this.locked(tx, groupId);
      await this.manage(tx, group, actor);
      requireRule(group.status === "Active", "GROUP_NOT_ACTIVE", "Only active groups can mark contributions overdue.");
      const now = this.clock.now(); const today = businessToday(now, group.groupTimeZone);
      const rows = await tx.query(`SELECT c.* FROM groups."Contributions" c WHERE c."GroupId" = $1 AND c."DueDate" < $2::date AND c."RecordedAmount" < c."ExpectedAmount" AND c."Status" <> 'Overdue'
        AND EXISTS (SELECT 1 FROM groups."MonthlyCycles" y WHERE y."Id" = c."CycleId" AND y."Status" = 'CollectingContributions') ORDER BY c."Id"`, [groupId, today]);
      let changed = 0;
      for (const row of rows) {
        const c = mapContribution(row); const before = cycleRepository.contributionSnapshot(c);
        if (markOverdue(c, today, now)) {
          changed++;
          await cycleRepository.saveContribution(tx, c, before);
          await writeGroupAudit(tx, { groupId, actorUserId: actor.userId, action: "CONTRIBUTION_MARKED_OVERDUE", createdAt: now, subjectId: c.id });
        }
      }
      return changed;
    });
  }

  async cycles(groupId: string, actor: GroupActor, management: boolean) {
    const group = await this.readable(groupId, actor, management);
    const cycles = await cycleRepository.cycles(this.db, groupId);
    const auctions = group.groupType === "Auction" ? await auctionWindows(this.db, groupId) : new Map<string, AuctionWindow>();
    return cycles.map((c) => withAuction(mapCycle(c, group.groupTimeZone), c, group, auctions.get(c.id)));
  }

  async cycle(groupId: string, cycleId: string, actor: GroupActor) {
    const group = await this.readable(groupId, actor, false);
    const cycle = await cycleRepository.cycle(this.db, groupId, cycleId);
    if (!cycle) throw new NotFoundError("Cycle not found.");
    const auctions = group.groupType === "Auction" ? await auctionWindows(this.db, groupId, cycleId) : new Map<string, AuctionWindow>();
    return withAuction(mapCycle(cycle, group.groupTimeZone), cycle, group, auctions.get(cycle.id));
  }

  async myContributions(actor: GroupActor, groupId: string | undefined, status: ContributionStatus | undefined, page: number, pageSize: number): Promise<Page<unknown>> {
    const params: unknown[] = [actor.userId];
    let where = `EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."Id" = c."MembershipId" AND m."UserId" = $1)`;
    if (groupId) { params.push(groupId); where += ` AND c."GroupId" = $${params.length}`; }
    if (status) { params.push(status); where += ` AND c."Status" = $${params.length}`; }
    page = clamp(page, 1, 100000); pageSize = clamp(pageSize, 1, 100);
    const total = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."Contributions" c WHERE ${where}`, params)).count;
    const items = (await this.db.query(`SELECT c.* FROM groups."Contributions" c WHERE ${where} ORDER BY c."DueDate", c."Id" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params)).map(mapContribution);
    return { items: await this.mapContributions(items, false), page, pageSize, totalCount: total };
  }

  async myGroupContributions(groupId: string, actor: GroupActor) {
    requireGroup(await groupRepository.hasMembership(this.db, groupId, actor.userId, ["Approved", "Active", "Completed"]), "MEMBERSHIP_REQUIRED", "An approved/current membership is required.");
    const items = (await this.db.query(`SELECT c.* FROM groups."Contributions" c WHERE c."GroupId" = $1 AND EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."Id" = c."MembershipId" AND m."UserId" = $2)
      ORDER BY c."DueDate", c."Id"`, [groupId, actor.userId])).map(mapContribution);
    return this.mapContributions(items, false);
  }

  async cycleContributions(groupId: string, cycleId: string, actor: GroupActor) {
    await this.readable(groupId, actor, true);
    if (!(await cycleRepository.cycle(this.db, groupId, cycleId))) throw new NotFoundError("Cycle not found in this group.");
    const items = await cycleRepository.contributions(this.db, { groupId, cycleId });
    const mapped = await this.mapContributions(items, true);
    return mapped.sort((a, b) => (a.slotNumber ?? Number.MAX_SAFE_INTEGER) - (b.slotNumber ?? Number.MAX_SAFE_INTEGER));
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------

  private async locked(db: Queryable, id: string): Promise<Group> {
    const g = await groupRepository.lock(db, id);
    if (!g) throw new NotFoundError("Group not found.");
    return g;
  }

  private async organizerApproved(db: Queryable, g: Group): Promise<boolean> {
    return g.creatorType === "Platform" || (await organizerRepository.isApproved(db, g.createdByUserId));
  }

  /** Platform groups: admins only. Organizer groups: the creating organizer, who must still be approved. */
  private async manage(db: Queryable, g: Group, actor: GroupActor): Promise<void> {
    if (!(await authRepository.directory(db, actor.userId))) throw new UnauthorizedError();
    requireGroup(g.creatorType === "Platform" ? actor.isAdmin : g.createdByUserId === actor.userId, "NOT_GROUP_OWNER",
      "Only the group's approved organizer or platform administrator may operate this group.");
    requireGroup(await this.organizerApproved(db, g), "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
  }

  private async readable(id: string, actor: GroupActor, management: boolean): Promise<Group> {
    if (!(await authRepository.directory(this.db, actor.userId))) throw new UnauthorizedError();
    const group = await groupRepository.find(this.db, id);
    if (!group) throw new NotFoundError("Group not found.");
    if (actor.isAdmin) return group;
    if (group.creatorType === "Organizer" && group.createdByUserId === actor.userId) {
      if (management) requireGroup(await this.organizerApproved(this.db, group), "ORGANIZER_NOT_APPROVED", "Organizer must be approved for management access.");
      return group;
    }
    requireGroup(!management && (await groupRepository.hasMembership(this.db, id, actor.userId, ["Approved", "Active", "Completed"])),
      management ? "NOT_GROUP_OWNER" : "MEMBERSHIP_REQUIRED", "You do not have access to this group's contribution information.");
    return group;
  }

  private async mapContributions(items: Contribution[], management: boolean) {
    const groups = await groupRepository.findMany(this.db, items.map((c) => c.groupId));
    const cycles = await cycleRepository.cyclesByIds(this.db, items.map((c) => c.cycleId));
    const memberships = await groupRepository.membershipsByIds(this.db, items.map((c) => c.membershipId));
    const entries = management ? await cycleRepository.entries(this.db, items.map((c) => c.id)) : [];
    const users = management ? await authRepository.directoryMany(this.db, [...memberships.values()].map((m) => m.userId)) : new Map();
    return items.map((c) => {
      const g = groups.get(c.groupId)!; const m = memberships.get(c.membershipId)!;
      return {
        id: c.id, groupId: c.groupId, groupName: g.name, cycleId: c.cycleId, cycleNumber: cycles.get(c.cycleId)!.cycleNumber, membershipId: c.membershipId, slotNumber: m.slotNumber,
        memberName: management ? (users.get(m.userId)?.name ?? "Unavailable member") : null, dueDate: c.dueDate, groupTimeZone: g.groupTimeZone, expectedAmount: c.expectedAmount,
        recordedAmount: c.recordedAmount, status: snakeUpper(c.status), recordedAt: c.recordedAt, entries: entries.filter((e) => e.contributionId === c.id).map(mapEntry),
        collectionMode: snakeUpper(g.rules.collectionMode), financiallySettledAmount: c.financiallySettledAmount, financialStatus: snakeUpper(c.financialStatus),
      };
    });
  }
}

export const mapEntry = (e: ContributionEntry) => ({
  id: e.id, entryType: snakeUpper(e.entryType), amount: e.amount, reference: e.reference, note: e.note, recordedByUserId: e.recordedByUserId, createdAt: e.createdAt, reversesEntryId: e.reversesEntryId,
});

export function mapCycle(c: MonthlyCycle, timeZone: string) {
  return {
    id: c.id, groupId: c.groupId, cycleNumber: c.cycleNumber, selectionMethod: snakeUpper(c.selectionMethod), status: snakeUpper(c.status), contributionDueDate: c.contributionDueDate,
    selectionDate: c.selectionDate, payoutDate: c.payoutDate, groupTimeZone: timeZone, expectedMemberCount: c.expectedMemberCount, expectedContributionPerMember: c.expectedContributionPerMember,
    expectedPoolAmount: c.expectedPoolAmount, recordedContributionAmount: c.recordedContributionAmount, fullyRecordedMemberCount: c.fullyRecordedMemberCount,
    pendingMemberCount: c.expectedMemberCount - c.fullyRecordedMemberCount, startedAt: c.startedAt, contributionsCompletedAt: c.contributionsCompletedAt,
    readyForSelectionAt: c.readyForSelectionAt, selectionCompletedAt: c.selectionCompletedAt, selectionResultId: c.selectionResultId, collectionMode: snakeUpper(c.collectionMode),
    financiallySettledAmount: c.financiallySettledAmount, financiallySettledMemberCount: c.financiallySettledMemberCount,
    auctionStartsAt: null as Date | null, auctionEndsAt: null as Date | null, auctionStatus: null as string | null, auctionRescheduleCount: 0,
  };
}

interface AuctionWindow { startsAt: Date; endsAt: Date; status: string; rescheduleCount: number }

async function auctionWindows(db: Queryable, groupId: string, cycleId?: string): Promise<Map<string, AuctionWindow>> {
  const rows = await db.query<{ CycleId: string; StartsAt: Date; EndsAt: Date; Status: string; RescheduleCount: number }>(
    `SELECT "CycleId","StartsAt","EndsAt","Status","RescheduleCount" FROM groups."Auctions" WHERE "GroupId" = $1${cycleId ? ` AND "CycleId" = $2` : ""}`, cycleId ? [groupId, cycleId] : [groupId]);
  return new Map(rows.map((r) => [r.CycleId, { startsAt: r.StartsAt, endsAt: r.EndsAt, status: r.Status, rescheduleCount: r.RescheduleCount }]));
}

/** Auction cycles carry the authoritative window (rescheduled or rule-derived) and its reschedule count. */
function withAuction(details: ReturnType<typeof mapCycle>, cycle: MonthlyCycle, group: Group, auction: AuctionWindow | undefined) {
  if (cycle.selectionMethod !== "Auction") return details;
  if (auction) return { ...details, auctionStartsAt: auction.startsAt, auctionEndsAt: auction.endsAt, auctionStatus: snakeUpper(auction.status), auctionRescheduleCount: auction.rescheduleCount };
  const rules = group.rules.auctionRules;
  if (!rules) return details;
  // Rule times are UTC clock times; the calendar day is the cycle's selection date.
  return { ...details, auctionStartsAt: utcInstant(cycle.selectionDate, rules.auctionStartTime), auctionEndsAt: utcInstant(cycle.selectionDate, rules.auctionEndTime), auctionStatus: "SCHEDULED" };
}
