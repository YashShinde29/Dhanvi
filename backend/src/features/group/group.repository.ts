import { snapshot, type Snapshot, updateChanged } from "../../infra/database/changes.js";
import type { Queryable } from "../../infra/database/db.js";
import type { Decimal } from "../../utils/money.js";
import { rulesFromJson, rulesToJson } from "./group.domain.js";
import type { CreatorType, Group, GroupStatus, GroupType, Membership, MembershipStatus, RuleVersion } from "./group.types.js";

interface GroupRow {
  Id: string; Name: string; Description: string; CreatorType: CreatorType; CreatedByUserId: string; Rules: unknown; GroupType: GroupType;
  GroupValue: Decimal; MemberLimit: number; MonthlyContribution: Decimal; DurationMonths: number; Status: GroupStatus; CurrentMemberCount: number;
  RulesLocked: boolean; RulesVersion: number; Version: number; CreatedAt: Date; UpdatedAt: Date; PublishedAt: Date | null; StatusReason: string | null;
  ActivatedAt: Date | null; CurrentCycleNumber: number | null; GroupTimeZone: string; CompletedAt: Date | null;
}

export const mapGroup = (r: GroupRow): Group => ({
  id: r.Id, name: r.Name, description: r.Description, creatorType: r.CreatorType, createdByUserId: r.CreatedByUserId, rules: rulesFromJson(r.Rules),
  groupType: r.GroupType, groupValue: r.GroupValue, memberLimit: r.MemberLimit, monthlyContribution: r.MonthlyContribution, durationMonths: r.DurationMonths,
  status: r.Status, currentMemberCount: r.CurrentMemberCount, rulesLocked: r.RulesLocked, rulesVersion: r.RulesVersion, version: r.Version,
  createdAt: r.CreatedAt, updatedAt: r.UpdatedAt, publishedAt: r.PublishedAt, groupTimeZone: r.GroupTimeZone, activatedAt: r.ActivatedAt,
  currentCycleNumber: r.CurrentCycleNumber, completedAt: r.CompletedAt, statusReason: r.StatusReason,
});

interface MembershipRow {
  Id: string; GroupId: string; UserId: string; SlotNumber: number | null; Status: MembershipStatus; AppliedAt: Date; ApprovedAt: Date | null; RejectedAt: Date | null;
  RejectedReason: string | null; TermsVersionId: string | null; TermsAcceptedAt: Date | null; UpdatedAt: Date; HasBeenSelectedForPayout: boolean; PayoutCycleNumber: number | null;
}

export const mapMembership = (r: MembershipRow): Membership => ({
  id: r.Id, groupId: r.GroupId, userId: r.UserId, slotNumber: r.SlotNumber, status: r.Status, appliedAt: r.AppliedAt, approvedAt: r.ApprovedAt, rejectedAt: r.RejectedAt,
  rejectedReason: r.RejectedReason, termsVersionId: r.TermsVersionId, termsAcceptedAt: r.TermsAcceptedAt, updatedAt: r.UpdatedAt,
  hasBeenSelectedForPayout: r.HasBeenSelectedForPayout, payoutCycleNumber: r.PayoutCycleNumber,
});

/** Mutable group columns. Rules is serialized so jsonb is only rewritten when the rules actually changed. */
function groupColumns(g: Group) {
  return {
    Name: g.name, Description: g.description, Rules: rulesToJson(g.rules), GroupType: g.groupType, GroupValue: g.groupValue, MemberLimit: g.memberLimit,
    MonthlyContribution: g.monthlyContribution, DurationMonths: g.durationMonths, Status: g.status, CurrentMemberCount: g.currentMemberCount,
    RulesLocked: g.rulesLocked, RulesVersion: g.rulesVersion, Version: g.version, UpdatedAt: g.updatedAt, PublishedAt: g.publishedAt,
    StatusReason: g.statusReason, ActivatedAt: g.activatedAt, CurrentCycleNumber: g.currentCycleNumber, CompletedAt: g.completedAt,
  };
}

function membershipColumns(m: Membership) {
  return {
    SlotNumber: m.slotNumber, Status: m.status, ApprovedAt: m.approvedAt, RejectedAt: m.rejectedAt, RejectedReason: m.rejectedReason, TermsVersionId: m.termsVersionId,
    TermsAcceptedAt: m.termsAcceptedAt, UpdatedAt: m.updatedAt, HasBeenSelectedForPayout: m.hasBeenSelectedForPayout, PayoutCycleNumber: m.payoutCycleNumber,
  };
}

const mapVersion = (r: { Id: string; GroupId: string; VersionNumber: number; RulesSnapshot: string; RulesHash: string; CreatedAt: Date; CreatedByUserId: string }): RuleVersion => ({
  id: r.Id, groupId: r.GroupId, versionNumber: r.VersionNumber, rulesSnapshot: r.RulesSnapshot, rulesHash: r.RulesHash, createdAt: r.CreatedAt, createdByUserId: r.CreatedByUserId,
});

export const groupRepository = {
  async find(db: Queryable, id: string): Promise<Group | null> {
    const r = await db.maybeOne<GroupRow & Record<string, unknown>>(`SELECT * FROM groups."Groups" WHERE "Id" = $1`, [id]);
    return r && mapGroup(r);
  },
  /** The group row lock every group mutation takes first (contributions, selection, auctions, payments, payouts). */
  async lock(db: Queryable, id: string): Promise<Group | null> {
    const r = await db.maybeOne<GroupRow & Record<string, unknown>>(`SELECT * FROM groups."Groups" WHERE "Id" = $1 FOR UPDATE`, [id]);
    return r && mapGroup(r);
  },
  async findMany(db: Queryable, ids: string[]): Promise<Map<string, Group>> {
    if (ids.length === 0) return new Map();
    const rows = await db.query<GroupRow & Record<string, unknown>>(`SELECT * FROM groups."Groups" WHERE "Id" = ANY($1::uuid[])`, [[...new Set(ids)]]);
    return new Map(rows.map((r) => [r.Id, mapGroup(r)]));
  },
  async insert(db: Queryable, g: Group): Promise<void> {
    await db.execute(`INSERT INTO groups."Groups" ("Id","Name","Description","CreatorType","CreatedByUserId","Rules","GroupType","GroupValue","MemberLimit","MonthlyContribution","DurationMonths","Status","CurrentMemberCount","RulesLocked","RulesVersion","Version","CreatedAt","UpdatedAt","PublishedAt","StatusReason","ActivatedAt","CurrentCycleNumber","GroupTimeZone","CompletedAt")
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [g.id, g.name, g.description, g.creatorType, g.createdByUserId, rulesToJson(g.rules), g.groupType, g.groupValue.toFixed(), g.memberLimit, g.monthlyContribution.toFixed(),
        g.durationMonths, g.status, g.currentMemberCount, g.rulesLocked, g.rulesVersion, g.version, g.createdAt, g.updatedAt, g.publishedAt, g.statusReason, g.activatedAt,
        g.currentCycleNumber, g.groupTimeZone, g.completedAt]);
  },
  /** Column snapshot taken when a group is loaded; save() writes only what changed since. */
  groupSnapshot: (g: Group): Snapshot => snapshot(groupColumns(g)),
  /**
   * Writes the changed group columns, guarded by the EF concurrency token ("Version"). Callers hold the row lock, so a
   * mismatch is a programming error rather than a lost race.
   */
  async save(db: Queryable, g: Group, before: Snapshot): Promise<void> {
    const versionBefore = Number(before.Version?.split(":")[1]);
    const count = await updateChanged(db, `groups."Groups"`, g.id, before, groupColumns(g), { Version: versionBefore }, { Rules: "jsonb" });
    if (count !== 1) throw new Error("Group version conflict while holding the row lock.");
  },

  async memberships(db: Queryable, groupId: string, lock = false): Promise<Membership[]> {
    const rows = await db.query<MembershipRow & Record<string, unknown>>(`SELECT * FROM groups."GroupMemberships" WHERE "GroupId" = $1 ORDER BY "AppliedAt", "Id"${lock ? " FOR UPDATE" : ""}`, [groupId]);
    return rows.map(mapMembership);
  },
  async membership(db: Queryable, groupId: string, id: string): Promise<Membership | null> {
    const r = await db.maybeOne<MembershipRow & Record<string, unknown>>(`SELECT * FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "Id" = $2`, [groupId, id]);
    return r && mapMembership(r);
  },
  async membershipOf(db: Queryable, groupId: string, userId: string): Promise<Membership | null> {
    const r = await db.maybeOne<MembershipRow & Record<string, unknown>>(`SELECT * FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "UserId" = $2`, [groupId, userId]);
    return r && mapMembership(r);
  },
  async membershipsByIds(db: Queryable, ids: string[]): Promise<Map<string, Membership>> {
    if (ids.length === 0) return new Map();
    const rows = await db.query<MembershipRow & Record<string, unknown>>(`SELECT * FROM groups."GroupMemberships" WHERE "Id" = ANY($1::uuid[])`, [[...new Set(ids)]]);
    return new Map(rows.map((r) => [r.Id, mapMembership(r)]));
  },
  async hasMembership(db: Queryable, groupId: string, userId: string, statuses?: MembershipStatus[]): Promise<boolean> {
    const r = statuses
      ? await db.maybeOne(`SELECT 1 FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "UserId" = $2 AND "Status" = ANY($3::text[]) LIMIT 1`, [groupId, userId, statuses])
      : await db.maybeOne(`SELECT 1 FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "UserId" = $2 LIMIT 1`, [groupId, userId]);
    return r !== null;
  },
  async insertMembership(db: Queryable, m: Membership): Promise<void> {
    await db.execute(`INSERT INTO groups."GroupMemberships" ("Id","GroupId","UserId","SlotNumber","Status","AppliedAt","ApprovedAt","RejectedAt","RejectedReason","TermsVersionId","TermsAcceptedAt","UpdatedAt","HasBeenSelectedForPayout","PayoutCycleNumber")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [m.id, m.groupId, m.userId, m.slotNumber, m.status, m.appliedAt, m.approvedAt, m.rejectedAt, m.rejectedReason, m.termsVersionId, m.termsAcceptedAt, m.updatedAt, m.hasBeenSelectedForPayout, m.payoutCycleNumber]);
  },
  membershipSnapshot: (m: Membership): Snapshot => snapshot(membershipColumns(m)),
  async saveMembership(db: Queryable, m: Membership, before: Snapshot): Promise<void> {
    await updateChanged(db, `groups."GroupMemberships"`, m.id, before, membershipColumns(m));
  },
  async countMemberships(db: Queryable, groupId: string, status: MembershipStatus): Promise<number> {
    return (await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "Status" = $2`, [groupId, status])).count;
  },

  async ruleVersion(db: Queryable, groupId: string, versionNumber: number): Promise<RuleVersion | null> {
    const r = await db.maybeOne<{ Id: string; GroupId: string; VersionNumber: number; RulesSnapshot: string; RulesHash: string; CreatedAt: Date; CreatedByUserId: string }>(
      `SELECT * FROM groups."GroupRuleVersions" WHERE "GroupId" = $1 AND "VersionNumber" = $2`, [groupId, versionNumber]);
    return r && mapVersion(r);
  },
  async currentRuleVersions(db: Queryable, groups: Group[]): Promise<Map<string, RuleVersion>> {
    if (groups.length === 0) return new Map();
    const rows = await db.query<{ Id: string; GroupId: string; VersionNumber: number; RulesSnapshot: string; RulesHash: string; CreatedAt: Date; CreatedByUserId: string }>(
      `SELECT v.* FROM groups."GroupRuleVersions" v JOIN groups."Groups" g ON g."Id" = v."GroupId" AND g."RulesVersion" = v."VersionNumber" WHERE v."GroupId" = ANY($1::uuid[])`, [groups.map((g) => g.id)]);
    return new Map(rows.map((r) => [r.GroupId, mapVersion(r)]));
  },
  async insertRuleVersion(db: Queryable, v: RuleVersion): Promise<void> {
    await db.execute(`INSERT INTO groups."GroupRuleVersions" ("Id","GroupId","VersionNumber","RulesSnapshot","RulesHash","CreatedAt","CreatedByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [v.id, v.groupId, v.versionNumber, v.rulesSnapshot, v.rulesHash, v.createdAt, v.createdByUserId]);
  },
  async insertTermsAcceptance(db: Queryable, id: string, a: { membershipId: string; groupRuleVersionId: string; acceptedAt: Date; rulesHash: string }): Promise<void> {
    await db.execute(`INSERT INTO groups."GroupTermsAcceptances" ("Id","MembershipId","GroupRuleVersionId","AcceptedAt","RulesHash") VALUES ($1,$2,$3,$4,$5)`,
      [id, a.membershipId, a.groupRuleVersionId, a.acceptedAt, a.rulesHash]);
  },
};
