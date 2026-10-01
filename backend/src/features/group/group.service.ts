import type { GroupMemberPolicy } from "../../config/groups.js";
import type { Database, Queryable } from "../../infra/database/db.js";
import type { Clock, Page } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { newId } from "../../utils/crypto.js";
import { snakeUpper } from "../../utils/enums.js";
import { GroupRuleError, NotFoundError, requireGroup, UnauthorizedError } from "../../utils/errors.js";
import type { Decimal } from "../../utils/money.js";
import { writeGroupAudit } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import type { GroupUserInfo } from "../auth/auth.types.js";
import { organizerRepository } from "../organizer/organizer.repository.js";
import * as domain from "./group.domain.js";
import { groupRepository, mapGroup, mapMembership } from "./group.repository.js";
import type { CreatorType, Group, GroupActor, GroupConfiguration, GroupStatus, GroupType, Membership, RuleVersion } from "./group.types.js";

export interface SaveGroupInput { name: string; description: string; rules: GroupConfiguration }

export interface GroupFilter {
  groupType?: GroupType; creatorType?: CreatorType; status?: GroupStatus; minGroupValue?: Decimal; maxGroupValue?: Decimal; memberLimit?: number;
  organizerId?: string; page: number; pageSize: number; sort?: string; search?: string; section?: string;
}

export type GroupOperation = "publish" | "apply" | "approve" | "reject" | "accept-terms" | "confirm-ready" | "suspend" | "cancel";

const PUBLIC_STATUSES: GroupStatus[] = ["Published", "Recruiting", "FullySubscribed", "ReadyToStart"];

/** Port of GroupService (groups + membership lifecycle). Every mutation runs under `SELECT … FOR UPDATE` of the group row. */
export class GroupService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly policy: GroupMemberPolicy,
    private readonly razorpayEnabled: boolean) {}

  private checkCollectionMode(rules: GroupConfiguration): void {
    requireGroup(rules.collectionMode !== "Razorpay" || this.razorpayEnabled, "PAYMENTS_DISABLED", "Razorpay Test collection is disabled.");
  }

  async create(actor: GroupActor, creator: CreatorType, input: SaveGroupInput) {
    requireGroup(creator !== "Platform" || actor.isAdmin, "NOT_GROUP_OWNER", "Platform permission is required.");
    await this.ensureUser(this.db, actor);
    this.checkCollectionMode(input.rules);
    const approved = creator === "Organizer" && (await organizerRepository.isApproved(this.db, actor.userId));
    const now = this.clock.now();
    const g = domain.createGroup(newId(), input.name, input.description, creator, actor.userId, input.rules, approved, now, this.policy);
    await this.db.transaction(async (tx) => {
      await groupRepository.insert(tx, g);
      await writeGroupAudit(tx, { groupId: g.id, actorUserId: actor.userId, action: "GROUP_CREATED", createdAt: now });
      if (g.rules.organizerParticipates) {
        // The organizer's own membership is created atomically with the group and occupies slot 1.
        const member = domain.newMembership(newId(), g.id, actor.userId, now);
        domain.approveMembership(member, 1, now);
        await groupRepository.insertMembership(tx, member);
        await writeGroupAudit(tx, { groupId: g.id, actorUserId: actor.userId, action: "ORGANIZER_ADDED_AS_MEMBER", createdAt: now });
      }
    });
    return this.details(this.db, [g], actor, true).then((r) => r[0]);
  }

  async update(id: string, actor: GroupActor, input: SaveGroupInput) {
    const g = await this.db.transaction(async (tx) => {
      const group = await this.locked(tx, id);
      const before = groupRepository.groupSnapshot(group);
      await this.manage(tx, group, actor);
      this.checkCollectionMode(input.rules);
      // Participation cannot be introduced by edit: membership creation is atomic with group creation.
      requireGroup(group.rules.organizerParticipates === input.rules.organizerParticipates, "GROUP_RULES_LOCKED", "Choose organizer participation when creating the group.");
      const now = this.clock.now();
      domain.updateGroup(group, input.name, input.description, input.rules, now, this.policy);
      await groupRepository.save(tx, group, before);
      await writeGroupAudit(tx, { groupId: group.id, actorUserId: actor.userId, action: "GROUP_UPDATED", createdAt: now });
      return group;
    });
    return (await this.details(this.db, [g], actor, true))[0];
  }

  async browse(filter: GroupFilter, actor: GroupActor | null, scope: "public" | "mine" | "organizer" | "admin"): Promise<Page<unknown>> {
    const where: string[] = []; const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (scope === "admin") requireGroup(actor?.isAdmin === true, "NOT_GROUP_OWNER", "Admin permission required.");
    else if (scope === "organizer") {
      requireGroup(actor !== null && (await organizerRepository.isApproved(this.db, actor.userId)), "ORGANIZER_NOT_APPROVED", "Approved organizer required.");
      where.push(`g."CreatorType" = 'Organizer' AND g."CreatedByUserId" = ${p(actor.userId)}`);
    } else if (scope === "mine") {
      if (!actor) throw new UnauthorizedError();
      const me = p(actor.userId);
      where.push(`EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."GroupId" = g."Id" AND m."UserId" = ${me})`);
      switch (filter.section) {
        case "APPLICATIONS": where.push(`EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."GroupId" = g."Id" AND m."UserId" = ${me} AND m."Status" IN ('Applied','Rejected'))`); break;
        case "UPCOMING": where.push(`g."Status" IN ('Draft','Recruiting','FullySubscribed') AND EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."GroupId" = g."Id" AND m."UserId" = ${me} AND m."Status" = 'Approved')`); break;
        case "READY_TO_START": where.push(`g."Status" = 'ReadyToStart'`); break;
        case "ACTIVE": where.push(`g."Status" = 'Active'`); break;
        case "COMPLETED": where.push(`g."Status" = 'Completed'`); break;
        default: break;
      }
    } else where.push(`g."Status" = ANY(${p(PUBLIC_STATUSES)}::text[])`);
    if (filter.groupType) where.push(`g."GroupType" = ${p(filter.groupType)}`);
    if (filter.creatorType) where.push(`g."CreatorType" = ${p(filter.creatorType)}`);
    if (filter.status) where.push(`g."Status" = ${p(filter.status)}`);
    if (filter.minGroupValue) where.push(`g."GroupValue" >= ${p(filter.minGroupValue.toFixed())}`);
    if (filter.maxGroupValue) where.push(`g."GroupValue" <= ${p(filter.maxGroupValue.toFixed())}`);
    if (filter.memberLimit !== undefined) where.push(`g."MemberLimit" = ${p(filter.memberLimit)}`);
    if (filter.organizerId) where.push(`g."CreatorType" = 'Organizer' AND g."CreatedByUserId" = ${p(filter.organizerId)}`);
    if (filter.search?.trim()) where.push(`g."Name" ILIKE ${p(`%${filter.search.trim()}%`)}`);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."Groups" g ${clause}`, params)).count;
    const page = clamp(filter.page, 1, 100000); const size = clamp(filter.pageSize, 1, 100);
    const order = filter.sort === "value_asc" ? `g."GroupValue", g."Id"` : filter.sort === "value_desc" ? `g."GroupValue" DESC, g."Id"` : `g."CreatedAt" DESC, g."Id"`;
    const rows = await this.db.query(`SELECT g.* FROM groups."Groups" g ${clause} ORDER BY ${order} LIMIT ${p(size)} OFFSET ${p((page - 1) * size)}`, params);
    const groups = rows.map((r) => mapGroup(r as unknown as Parameters<typeof mapGroup>[0]));
    return { items: await this.details(this.db, groups, actor, scope === "admin" || scope === "organizer"), page, pageSize: size, totalCount: total };
  }

  async get(id: string, actor: GroupActor | null, management: boolean) {
    const g = await groupRepository.find(this.db, id);
    if (!g) throw new NotFoundError("Group not found.");
    const owner = actor !== null && (actor.isAdmin || (g.creatorType === "Organizer" && g.createdByUserId === actor.userId));
    if (management && !owner) throw new GroupRuleError("NOT_GROUP_OWNER", "This group belongs to another creator.");
    if (!PUBLIC_STATUSES.includes(g.status) && !owner && (actor === null || !(await groupRepository.hasMembership(this.db, id, actor.userId))))
      throw new NotFoundError("Group not found.");
    return (await this.details(this.db, [g], actor, management))[0];
  }

  /** GroupService.ExecuteAsync — all membership and lifecycle commands. */
  async execute(id: string, actor: GroupActor, operation: GroupOperation, args: { membershipId?: string; termsVersionId?: string; rulesHash?: string; reason?: string } = {}): Promise<void> {
    await this.ensureUser(this.db, actor);
    await this.db.transaction(async (tx) => {
      const g = await this.locked(tx, id);
      const before = groupRepository.groupSnapshot(g);
      const now = this.clock.now();
      const audit = (action: string) => writeGroupAudit(tx, { groupId: g.id, actorUserId: actor.userId, action, createdAt: now });
      if (operation !== "apply" && operation !== "accept-terms") await this.manage(tx, g, actor, operation === "suspend" || operation === "cancel");
      switch (operation) {
        case "publish": {
          const version = domain.publish(g, await organizerRepository.isApproved(tx, g.createdByUserId), now, this.policy);
          await groupRepository.save(tx, g, before);
          await groupRepository.insertRuleVersion(tx, version);
          await audit("GROUP_PUBLISHED"); await audit("GROUP_RULE_VERSION_CREATED");
          return;
        }
        case "apply": {
          domain.ensureJoinable(g);
          requireGroup(!(await groupRepository.hasMembership(tx, id, actor.userId)), "ALREADY_APPLIED", "You already have an application or membership in this group.");
          await groupRepository.insertMembership(tx, domain.newMembership(newId(), id, actor.userId, now));
          await audit("GROUP_APPLICATION_SUBMITTED");
          return;
        }
        case "approve":
        case "reject": {
          const member = args.membershipId ? await groupRepository.membership(tx, id, args.membershipId) : null;
          if (!member) throw new NotFoundError("Application not found.");
          const memberBefore = groupRepository.membershipSnapshot(member);
          requireGroup(member.status === "Applied", "APPLICATION_ALREADY_REVIEWED", "Application already reviewed.");
          if (operation === "approve") {
            // Capacity is decided under the group row lock: the final slot can be approved exactly once.
            domain.approveMembership(member, domain.approveMember(g, now), now);
            await groupRepository.save(tx, g, before);
            await groupRepository.saveMembership(tx, member, memberBefore);
            await audit("GROUP_APPLICATION_APPROVED");
            if (g.status === "FullySubscribed") await audit("GROUP_FULLY_SUBSCRIBED");
          } else {
            requireGroup(g.status === "Recruiting" || g.status === "FullySubscribed", "GROUP_NOT_JOINABLE", "Applications cannot be reviewed in this state.");
            domain.rejectMembership(member, args.reason ?? "", now);
            await groupRepository.saveMembership(tx, member, memberBefore);
            await audit("GROUP_APPLICATION_REJECTED");
          }
          return;
        }
        case "accept-terms": {
          requireGroup(g.status === "Recruiting" || g.status === "FullySubscribed", "GROUP_NOT_JOINABLE", "Terms cannot be accepted in this state.");
          const current = await groupRepository.ruleVersion(tx, id, g.rulesVersion);
          if (!current) throw new Error("Current rule version is missing.");
          requireGroup(current.id === args.termsVersionId?.toLowerCase() && current.rulesHash === args.rulesHash, "CURRENT_RULE_VERSION_REQUIRED", "Review and accept the current version and hash.");
          const own = await groupRepository.membershipOf(tx, id, actor.userId);
          if (!own) throw new NotFoundError("Membership not found.");
          const ownBefore = groupRepository.membershipSnapshot(own);
          const acceptance = domain.acceptTerms(own, current, now);
          domain.lockRules(g, now);
          await groupRepository.insertTermsAcceptance(tx, newId(), acceptance);
          await groupRepository.saveMembership(tx, own, ownBefore);
          await groupRepository.save(tx, g, before);
          await audit("GROUP_TERMS_ACCEPTED");
          return;
        }
        case "confirm-ready": {
          const members = (await groupRepository.memberships(tx, id)).filter((m) => m.status === "Approved");
          const rules = await groupRepository.ruleVersion(tx, id, g.rulesVersion);
          const allAccepted = rules !== null && members.every((m) => m.termsVersionId === rules.id && m.termsAcceptedAt !== null);
          domain.confirmReady(g, allAccepted, members.length, await organizerRepository.isApproved(tx, g.createdByUserId), now);
          await groupRepository.save(tx, g, before);
          await audit("GROUP_READY_TO_START");
          return;
        }
        case "suspend":
        case "cancel": {
          const wasActive = g.status === "Active";
          domain.stop(g, operation === "cancel", args.reason ?? "", now);
          await groupRepository.save(tx, g, before);
          if (wasActive) await audit("GROUP_SUSPENDED_DURING_ACTIVE_CYCLE");
          await audit(operation === "cancel" ? "GROUP_CANCELLED" : "GROUP_SUSPENDED");
          return;
        }
      }
    });
  }

  async members(id: string, actor: GroupActor) {
    const g = await groupRepository.find(this.db, id);
    if (!g) throw new NotFoundError("Group not found.");
    if (!actor.isAdmin) await this.manage(this.db, g, actor);
    const members = await groupRepository.memberships(this.db, id);
    const users = await authRepository.directoryMany(this.db, members.map((m) => m.userId));
    return members.map((m) => mapMember(m, users.get(m.userId), true));
  }

  async contact(id: string, actor: GroupActor) {
    const g = await groupRepository.find(this.db, id);
    if (!g) throw new NotFoundError("Group not found.");
    requireGroup(g.creatorType === "Organizer" && g.status !== "Cancelled" && (await groupRepository.hasMembership(this.db, id, actor.userId, ["Approved", "Active"])),
      "MEMBERSHIP_REQUIRED", "Organizer contact is available only to approved current members.");
    const user = await authRepository.directory(this.db, g.createdByUserId);
    if (!user) throw new NotFoundError("Organizer unavailable.");
    return { name: user.name, phone: user.phone, email: user.email };
  }

  // ---- shared helpers -------------------------------------------------------------------------------------------

  private async locked(db: Queryable, id: string): Promise<Group> {
    const g = await groupRepository.lock(db, id);
    if (!g) throw new NotFoundError("Group not found.");
    return g;
  }

  private async ensureUser(db: Queryable, actor: GroupActor): Promise<void> {
    if (!(await authRepository.directory(db, actor.userId))) throw new UnauthorizedError();
  }

  /** Platform groups: admins. Organizer groups: the approved creating organizer; admins only for moderation (suspend/cancel). */
  private async manage(db: Queryable, g: Group, actor: GroupActor, moderation = false): Promise<void> {
    if (actor.isAdmin && (g.creatorType === "Platform" || moderation)) return;
    requireGroup(g.creatorType === "Organizer" && g.createdByUserId === actor.userId, "NOT_GROUP_OWNER", "You cannot manage another creator's group.");
    requireGroup(await organizerRepository.isApproved(db, actor.userId), "ORGANIZER_NOT_APPROVED", "Organizer must be approved.");
  }

  /** GroupService.Map for a page of groups, with batched lookups. */
  private async details(db: Queryable, groups: Group[], actor: GroupActor | null, management: boolean) {
    const organizerIds = groups.filter((g) => g.creatorType === "Organizer").map((g) => g.createdByUserId);
    const users = await authRepository.directoryMany(db, organizerIds);
    const statuses = await organizerRepository.statusNames(db, [...users.keys()]);
    const versions = await groupRepository.currentRuleVersions(db, groups);
    const ids = groups.map((g) => g.id);
    const own = actor && ids.length ? await db.query(`SELECT * FROM groups."GroupMemberships" WHERE "GroupId" = ANY($1::uuid[]) AND "UserId" = $2`, [ids, actor.userId]) : [];
    const ownByGroup = new Map(own.map((r) => { const m = mapMembership(r as unknown as Parameters<typeof mapMembership>[0]); return [m.groupId, m]; }));
    const pending = management && ids.length
      ? new Map((await db.query<{ GroupId: string; count: number }>(`SELECT "GroupId", count(*)::int AS count FROM groups."GroupMemberships" WHERE "GroupId" = ANY($1::uuid[]) AND "Status" = 'Applied' GROUP BY "GroupId"`, [ids])).map((r) => [r.GroupId, r.count]))
      : new Map<string, number>();
    const self = actor ? await authRepository.directory(db, actor.userId) : null;
    return groups.map((g) => {
      const organizerUser = g.creatorType === "Organizer" ? users.get(g.createdByUserId) : undefined;
      const ownMembership = ownByGroup.get(g.id);
      return mapGroupDetails(g, organizerUser ? { name: organizerUser.name, verified: organizerUser.verified, status: statuses.get(organizerUser.id) ?? "NOT_APPLIED", memberSince: organizerUser.memberSince } : null,
        versions.get(g.id) ?? null, ownMembership ? mapMember(ownMembership, self ?? undefined, false) : null, management ? (pending.get(g.id) ?? 0) : 0, management);
    });
  }
}

export function mapMember(m: Membership, user: GroupUserInfo | undefined, includeEmail: boolean) {
  return {
    id: m.id, userId: m.userId, name: user?.name ?? "Unavailable user", email: includeEmail ? (user?.email ?? null) : null, slotNumber: m.slotNumber,
    status: snakeUpper(m.status), appliedAt: m.appliedAt, approvedAt: m.approvedAt, termsVersionId: m.termsVersionId, termsAcceptedAt: m.termsAcceptedAt,
    rejectedReason: m.rejectedReason, hasBeenSelectedForPayout: m.hasBeenSelectedForPayout, payoutCycleNumber: m.payoutCycleNumber,
  };
}

function mapGroupDetails(g: Group, organizer: { name: string; verified: boolean; status: string; memberSince: Date } | null, version: RuleVersion | null,
  myMembership: ReturnType<typeof mapMember> | null, pendingApplications: number, management: boolean) {
  const r = g.rules;
  return {
    id: g.id, name: g.name, description: g.description, groupType: snakeUpper(r.groupType), creatorType: snakeUpper(g.creatorType), groupValue: r.groupValue,
    memberLimit: r.memberLimit, currentMemberCount: g.currentMemberCount, availableSlots: r.memberLimit - g.currentMemberCount, monthlyContribution: g.monthlyContribution,
    durationMonths: g.durationMonths, organizerParticipates: r.organizerParticipates, organizerFirstPayout: r.organizerFirstPayout,
    firstCycleSelectionMethod: snakeUpper(domain.firstCycleSelectionMethod(r)), contributionDueDay: r.contributionDueDay, selectionDay: r.selectionDay, payoutDay: r.payoutDay,
    startDate: r.startDate, status: snakeUpper(g.status), rulesVersion: g.rulesVersion, rulesLocked: g.rulesLocked, organizer,
    currentRules: version && { id: version.id, versionNumber: version.versionNumber, rulesSnapshot: version.rulesSnapshot, rulesHash: version.rulesHash },
    myMembership, pendingApplications,
    auctionRules: r.auctionRules && { minimumDiscount: r.auctionRules.minimumDiscount, maximumDiscount: r.auctionRules.maximumDiscount, bidIncrement: r.auctionRules.bidIncrement,
      auctionStartTime: r.auctionRules.auctionStartTime, auctionEndTime: r.auctionRules.auctionEndTime, feePolicy: snakeUpper(r.auctionRules.feePolicy) },
    randomRules: r.randomRules && { algorithmVersion: r.randomRules.algorithmVersion, drawTime: r.randomRules.drawTime, verificationMethod: r.randomRules.verificationMethod },
    statusReason: management ? g.statusReason : null, groupTimeZone: g.groupTimeZone, activatedAt: g.activatedAt, currentCycleNumber: g.currentCycleNumber,
    collectionMode: snakeUpper(r.collectionMode),
  };
}
