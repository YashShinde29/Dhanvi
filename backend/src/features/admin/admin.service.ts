import type { Database } from "../../infra/database/db.js";
import type { Clock } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { businessToday, dateOnlyMidnightUtc } from "../../utils/dates.js";
import { parseEnum, snakeUpper } from "../../utils/enums.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { authRepository } from "../auth/auth.repository.js";
import { CYCLE_STATUSES, type MonthlyCycle } from "../cycle/cycle.domain.js";
import { cycleRepository, mapContribution } from "../cycle/cycle.repository.js";
import { groupRepository, mapGroup } from "../group/group.repository.js";
import { CREATOR_TYPES, type Group, GROUP_STATUSES, GROUP_TYPES } from "../group/group.types.js";
import { organizerRepository } from "../organizer/organizer.repository.js";

export interface AdminGroupFilter { status?: string; creatorType?: string; groupType?: string; cycleStatus?: string; organizerId?: string; search?: string; page: number; pageSize: number; sort?: string }

type Bucket = { count: number; oldestSince: Date | null };
const EMPTY: Bucket = { count: 0, oldestSince: null };
const bucketSql = (fromWhere: string, column: string) => `SELECT count(*)::int AS count, min(${column}) AS "oldestSince" FROM ${fromWhere}`;

function parse<T extends string>(value: string | undefined, names: readonly T[], name: string): T | undefined {
  if (!value?.trim()) return undefined;
  const parsed = parseEnum(value, names);
  if (!parsed) throw new ValidationError({ [name]: [`Invalid ${name} filter.`] });
  return parsed;
}

/**
 * Port of the Admin Control Center read models. Pure projections of persisted state: nothing here decides a business
 * outcome. Status strings use the API's SNAKE_CASE_UPPER spelling.
 */
export class AdminOperationsService {
  constructor(private readonly db: Database, private readonly clock: Clock) {}

  private async bucket(fromWhere: string, column: string, params: unknown[] = []): Promise<Bucket> {
    const r = await this.db.one<{ count: number; oldestSince: Date | null }>(bucketSql(fromWhere, column), params);
    return r.count === 0 ? EMPTY : r;
  }

  async overview() {
    return { groups: await this.groupOverview(), payments: await this.paymentOverview(), payouts: await this.payoutOverview(), organizers: await this.organizerOverview(), generatedAt: this.clock.now() };
  }

  private async groupOverview() {
    const byStatus = new Map((await this.db.query<{ Status: string; count: number }>(`SELECT "Status", count(*)::int AS count FROM groups."Groups" GROUP BY "Status"`)).map((r) => [r.Status, r.count]));
    const n = (s: string) => byStatus.get(s) ?? 0;
    const activeMembers = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."GroupMemberships" WHERE "Status" = 'Active'`)).count;
    const current = `groups."MonthlyCycles" c JOIN groups."Groups" g ON g."Id" = c."GroupId" AND g."CurrentCycleNumber" = c."CycleNumber" AND g."Status" = 'Active'`;
    const today = businessToday(this.clock.now());
    const overdue = await this.db.one<{ count: number; min: string | null }>(`SELECT count(*)::int AS count, min(c."ContributionDueDate")::text AS min FROM ${current}
      WHERE c."Status" = 'CollectingContributions' AND c."ContributionDueDate" < $1::date`, [today]);
    return {
      total: [...byStatus.values()].reduce((a, b) => a + b, 0), draft: n("Draft"), recruiting: n("Recruiting") + n("Published"), fullySubscribed: n("FullySubscribed"), readyToStart: n("ReadyToStart"),
      active: n("Active") + n("Completing"), completed: n("Completed"), suspended: n("Suspended"), cancelled: n("Cancelled"), activeMembers,
      platformReadyToActivate: await this.bucket(`groups."Groups" WHERE "CreatorType" = 'Platform' AND "Status" = 'ReadyToStart'`, `"UpdatedAt"`),
      // Fully subscribed platform groups whose approved members have all accepted the current rules: confirmation is possible now.
      platformReadyToConfirm: await this.bucket(`groups."Groups" g WHERE g."CreatorType" = 'Platform' AND g."Status" = 'FullySubscribed' AND NOT EXISTS (SELECT 1 FROM groups."GroupMemberships" m
        WHERE m."GroupId" = g."Id" AND m."Status" = 'Approved' AND NOT EXISTS (SELECT 1 FROM groups."GroupRuleVersions" v WHERE v."GroupId" = g."Id" AND v."VersionNumber" = g."RulesVersion"
        AND v."Id" = m."TermsVersionId" AND m."TermsAcceptedAt" IS NOT NULL))`, `g."UpdatedAt"`),
      platformApplicationsPending: await this.bucket(`groups."GroupMemberships" m JOIN groups."Groups" g ON g."Id" = m."GroupId" WHERE m."Status" = 'Applied' AND g."CreatorType" = 'Platform'`, `m."AppliedAt"`),
      organizerGroupsAwaitingOrganizer: await this.bucket(`groups."Groups" WHERE "CreatorType" = 'Organizer' AND "Status" IN ('ReadyToStart','FullySubscribed')`, `"UpdatedAt"`),
      suspendedGroups: await this.bucket(`groups."Groups" WHERE "Status" = 'Suspended'`, `"UpdatedAt"`),
      cyclesCollecting: (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM ${current} WHERE c."Status" = 'CollectingContributions'`)).count,
      cyclesOverdueCollecting: overdue.count === 0 ? EMPTY : { count: overdue.count, oldestSince: dateOnlyMidnightUtc(overdue.min!) },
      platformCyclesReadyForSelection: await this.bucket(`${current} WHERE c."Status" = 'ReadyForSelection' AND g."CreatorType" = 'Platform'`, `COALESCE(c."ReadyForSelectionAt", c."UpdatedAt")`),
      organizerCyclesReadyForSelection: await this.bucket(`${current} WHERE c."Status" = 'ReadyForSelection' AND g."CreatorType" = 'Organizer'`, `COALESCE(c."ReadyForSelectionAt", c."UpdatedAt")`),
      // Only gateway-collected cycles can be prepared for payout (the ledger pool must be funded).
      cyclesSelectionCompleted: await this.bucket(`${current} WHERE c."Status" = 'SelectionCompleted' AND c."CollectionMode" = 'Razorpay'`, `COALESCE(c."SelectionCompletedAt", c."UpdatedAt")`),
      cyclesPayoutPending: (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM ${current} WHERE c."Status" = 'PayoutPending'`)).count,
      auctionsOpen: await this.bucket(`groups."Auctions" WHERE "Status" = 'Open'`, `COALESCE("OpenedAt", "UpdatedAt")`),
      auctionsClosedNoBids: await this.bucket(`groups."Auctions" WHERE "Status" = 'ClosedNoBids'`, `COALESCE("ClosedAt", "UpdatedAt")`),
    };
  }

  private paymentCounts(rows: Array<{ Status: string; count: number }>) {
    const of = (...s: string[]) => rows.filter((r) => s.includes(r.Status)).reduce((a, r) => a + r.count, 0);
    return { captured: of("Captured"), pending: of("Created", "Pending", "Authorized"), failed: of("Failed"), reconciliationRequired: of("ReconciliationRequired"), refunded: of("Refunded", "RefundPending") };
  }

  private async paymentOverview() {
    const counts = this.paymentCounts(await this.db.query(`SELECT "Status", count(*)::int AS count FROM payments."Payments" GROUP BY "Status"`));
    return {
      counts,
      reconciliationRequired: counts.reconciliationRequired === 0 ? EMPTY : await this.bucket(`payments."Payments" WHERE "Status" = 'ReconciliationRequired'`, `"UpdatedAt"`),
      pending: counts.pending === 0 ? EMPTY : await this.bucket(`payments."Payments" WHERE "Status" IN ('Pending','Authorized','Created')`, `"CreatedAt"`),
    };
  }

  /** Unapproved payouts whose recipient's latest account is usable now count as "awaiting approval"; the rest wait on the member. */
  private approvable = `p."Status" IN ('PendingBeneficiary','ApprovalRequired') AND p."UserId" IS NOT NULL AND COALESCE((SELECT b."AvailableAt" <= $1 FROM payouts."PayoutBeneficiaries" b
    WHERE b."UserId" = p."UserId" ORDER BY b."CreatedAt" DESC, b."Id" DESC LIMIT 1), false)`;

  private payoutCounts(rows: Array<{ Status: string; count: number }>) {
    const of = (...s: string[]) => rows.filter((r) => s.includes(r.Status)).reduce((a, r) => a + r.count, 0);
    return { pendingBeneficiary: of("PendingBeneficiary"), approvalRequired: of("ApprovalRequired"), approved: of("Approved"), processing: of("Processing", "ProviderPending"),
      succeeded: of("Succeeded"), failed: of("Failed"), reconciliationRequired: of("ReconciliationRequired"), cancelled: of("Cancelled") };
  }

  private async payoutOverview() {
    const now = this.clock.now();
    const raw = this.payoutCounts(await this.db.query(`SELECT "Status", count(*)::int AS count FROM payouts."PayoutObligations" GROUP BY "Status"`));
    const approvable = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM payouts."PayoutObligations" p WHERE ${this.approvable}`, [now])).count;
    const counts = { ...raw, approvalRequired: approvable, pendingBeneficiary: Math.max(0, raw.pendingBeneficiary + raw.approvalRequired - approvable) };
    const b = async (count: number, where: string, params: unknown[] = []) => (count === 0 ? EMPTY : this.bucket(`payouts."PayoutObligations" p WHERE ${where}`, `p."UpdatedAt"`, params));
    return {
      counts,
      approvalRequired: await b(counts.approvalRequired, this.approvable, [now]),
      readyToExecute: await b(counts.approved, `p."Status" = 'Approved'`),
      failed: await b(counts.failed, `p."Status" = 'Failed'`),
      reconciliationRequired: await b(counts.reconciliationRequired, `p."Status" = 'ReconciliationRequired'`),
      pendingBeneficiary: await b(counts.pendingBeneficiary, `p."Status" IN ('PendingBeneficiary','ApprovalRequired') AND NOT (${this.approvable})`, [now]),
      processing: await b(counts.processing, `p."Status" IN ('Processing','ProviderPending')`),
    };
  }

  private async organizerOverview() {
    const pending = await this.bucket(`organizers.organizer_applications WHERE "Status" IN ('Pending','UnderReview')`, `"SubmittedAt"`);
    const n = async (sql: string) => (await this.db.one<{ count: number }>(sql)).count;
    return {
      applicationsPending: pending,
      underReview: await n(`SELECT count(*)::int AS count FROM organizers.organizer_applications WHERE "Status" = 'UnderReview'`),
      approved: await n(`SELECT count(*)::int AS count FROM organizers.organizer_profiles WHERE "Status" = 'Approved'`),
      suspended: await n(`SELECT count(*)::int AS count FROM organizers.organizer_profiles WHERE "Status" = 'Suspended'`),
    };
  }

  async groups(f: AdminGroupFilter) {
    const params: unknown[] = []; const where: string[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const status = parse(f.status, GROUP_STATUSES, "GroupStatus"); const creator = parse(f.creatorType, CREATOR_TYPES, "GroupCreatorType");
    const type = parse(f.groupType, GROUP_TYPES, "GroupType"); const cycleStatus = parse(f.cycleStatus, CYCLE_STATUSES, "CycleStatus");
    if (status) where.push(`g."Status" = ${p(status)}`);
    if (creator) where.push(`g."CreatorType" = ${p(creator)}`);
    if (type) where.push(`g."GroupType" = ${p(type)}`);
    if (f.organizerId) where.push(`g."CreatorType" = 'Organizer' AND g."CreatedByUserId" = ${p(f.organizerId)}`);
    if (f.search?.trim()) where.push(`g."Name" ILIKE ${p(`%${f.search.trim()}%`)}`);
    if (cycleStatus) where.push(`g."CurrentCycleNumber" IS NOT NULL AND EXISTS (SELECT 1 FROM groups."MonthlyCycles" c WHERE c."GroupId" = g."Id" AND c."CycleNumber" = g."CurrentCycleNumber" AND c."Status" = ${p(cycleStatus)})`);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."Groups" g ${clause}`, params)).count;
    const page = clamp(f.page, 1, 100000); const size = clamp(f.pageSize, 1, 100);
    const order = f.sort === "name" ? `g."Name", g."Id"` : f.sort === "value_desc" ? `g."GroupValue" DESC, g."Id"` : `g."UpdatedAt" DESC, g."Id"`;
    const groups = (await this.db.query(`SELECT g.* FROM groups."Groups" g ${clause} ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`, params)).map((r) => mapGroup(r as never));
    return { items: await this.enrich(await this.rows(groups)), page, pageSize: size, totalCount: total };
  }

  async group(groupId: string) {
    const g = await groupRepository.find(this.db, groupId);
    if (!g) throw new NotFoundError("Group not found.");
    const [row] = await this.enrich(await this.rows([g]));
    const cycles = await this.snapshots(await cycleRepository.cycles(this.db, groupId));
    const outstanding = row!.currentCycle ? await this.outstanding(groupId, row!.currentCycle.id) : [];
    const payouts = await this.groupPayouts(groupId);
    const paymentIssues = (await this.db.query<Record<string, unknown>>(`SELECT * FROM payments."Payments" WHERE "GroupId" = $1 AND ("Status" IN ('ReconciliationRequired','Failed') OR "ReconciliationStatus" IN ('Mismatch','Failed'))
      ORDER BY "CreatedAt" DESC LIMIT 50`, [groupId])).map((p) => ({ id: p.Id, cycleId: p.CycleId, cycleNumber: p.CycleNumber, memberName: p.MemberName, amount: p.Amount,
      status: snakeUpper(p.Status as string), reconciliationStatus: snakeUpper(p.ReconciliationStatus as string), reconciliationMessage: p.ReconciliationMessage, createdAt: p.CreatedAt }));
    const activity = [...(await this.groupActivity(groupId, 60)), ...(await this.payoutActivity(groupId, 40))]
      .sort((a, b) => b.at.getTime() - a.at.getTime() || a.source.localeCompare(b.source)).slice(0, 80);
    return { group: row, cycles, outstandingContributions: outstanding, payouts, paymentIssues, issues: this.issues(row!, outstanding, payouts, paymentIssues), activity };
  }

  private async rows(groups: Group[]) {
    if (groups.length === 0) return [];
    const ids = groups.map((g) => g.id);
    const memberCounts = await this.db.query<{ GroupId: string; Status: string; count: number }>(`SELECT "GroupId","Status",count(*)::int AS count FROM groups."GroupMemberships" WHERE "GroupId" = ANY($1::uuid[]) GROUP BY 1,2`, [ids]);
    const terms = await this.db.query<{ GroupId: string; pending: number }>(`SELECT m."GroupId", count(*)::int AS pending FROM groups."GroupMemberships" m JOIN groups."Groups" g ON g."Id" = m."GroupId"
      LEFT JOIN groups."GroupRuleVersions" v ON v."GroupId" = g."Id" AND v."VersionNumber" = g."RulesVersion"
      WHERE m."GroupId" = ANY($1::uuid[]) AND m."Status" = 'Approved' AND NOT (m."TermsAcceptedAt" IS NOT NULL AND v."Id" IS NOT NULL AND m."TermsVersionId" = v."Id") GROUP BY 1`, [ids]);
    const lastActivity = new Map((await this.db.query<{ GroupId: string; at: Date }>(`SELECT "GroupId", max("CreatedAt") AS at FROM groups."GroupAuditEvents" WHERE "GroupId" = ANY($1::uuid[]) GROUP BY 1`, [ids])).map((r) => [r.GroupId, r.at]));
    const current = await this.db.query(`SELECT c.* FROM groups."MonthlyCycles" c JOIN groups."Groups" g ON g."Id" = c."GroupId" AND g."CurrentCycleNumber" = c."CycleNumber" WHERE c."GroupId" = ANY($1::uuid[])`, [ids]);
    const currentCycles = await cycleRepository.cyclesByIds(this.db, current.map((c) => c.Id as string));
    const snaps = new Map((await this.snapshots([...currentCycles.values()])).map((s) => [currentCycles.get(s.id)!.groupId, s]));
    const organizerIds = groups.filter((g) => g.creatorType === "Organizer").map((g) => g.createdByUserId);
    const users = await authRepository.directoryMany(this.db, organizerIds);
    const statuses = await organizerRepository.statusNames(this.db, organizerIds);
    return groups.map((g) => {
      const n = (s: string) => memberCounts.filter((x) => x.GroupId === g.id && x.Status === s).reduce((a, x) => a + x.count, 0);
      const organizer = g.creatorType === "Organizer";
      return {
        id: g.id, name: g.name, creatorType: snakeUpper(g.creatorType), groupType: snakeUpper(g.groupType), collectionMode: snakeUpper(g.rules.collectionMode), createdByUserId: g.createdByUserId,
        organizerName: organizer ? (users.get(g.createdByUserId)?.name ?? null) : null, organizerStatus: organizer ? (statuses.get(g.createdByUserId) ?? null) : null,
        groupValue: g.groupValue, monthlyContribution: g.monthlyContribution, memberLimit: g.memberLimit, currentMemberCount: g.currentMemberCount,
        activeMemberCount: n("Active") + n("Approved") + n("Completed"), pendingApplications: n("Applied"), termsPendingCount: terms.find((t) => t.GroupId === g.id)?.pending ?? 0,
        status: snakeUpper(g.status), statusReason: g.statusReason, startDate: g.rules.startDate, createdAt: g.createdAt, activatedAt: g.activatedAt, durationMonths: g.durationMonths,
        currentCycleNumber: g.currentCycleNumber, currentCycle: snaps.get(g.id) ?? null, payments: this.paymentCounts([]), payouts: this.payoutCounts([]),
        lastActivityAt: lastActivity.get(g.id) ?? g.updatedAt,
      };
    });
  }

  private async enrich<T extends { id: string; payments: unknown; payouts: unknown }>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const ids = rows.map((r) => r.id);
    const pay = await this.db.query<{ GroupId: string; Status: string; count: number }>(`SELECT "GroupId","Status",count(*)::int AS count FROM payments."Payments" WHERE "GroupId" = ANY($1::uuid[]) GROUP BY 1,2`, [ids]);
    const out = await this.db.query<{ GroupId: string; Status: string; count: number }>(`SELECT "GroupId","Status",count(*)::int AS count FROM payouts."PayoutObligations" WHERE "GroupId" = ANY($1::uuid[]) GROUP BY 1,2`, [ids]);
    const approvable = new Map((await this.db.query<{ GroupId: string; count: number }>(`SELECT p."GroupId", count(*)::int AS count FROM payouts."PayoutObligations" p WHERE ${this.approvable} AND p."GroupId" = ANY($2::uuid[]) GROUP BY 1`,
      [this.clock.now(), ids])).map((r) => [r.GroupId, r.count]));
    return rows.map((r) => {
      const payouts = this.payoutCounts(out.filter((x) => x.GroupId === r.id));
      const ready = approvable.get(r.id) ?? 0;
      return { ...r, payments: this.paymentCounts(pay.filter((x) => x.GroupId === r.id)),
        payouts: { ...payouts, approvalRequired: ready, pendingBeneficiary: Math.max(0, payouts.pendingBeneficiary + payouts.approvalRequired - ready) } };
    });
  }

  private async snapshots(cycles: MonthlyCycle[]) {
    if (cycles.length === 0) return [];
    const ids = cycles.map((c) => c.id);
    const auctions = await this.db.query<Record<string, unknown>>(`SELECT * FROM groups."Auctions" WHERE "CycleId" = ANY($1::uuid[])`, [ids]);
    const bids = new Map((await this.db.query<{ CycleId: string; count: number }>(`SELECT "CycleId", count(*)::int AS count FROM groups."AuctionBids" WHERE "CycleId" = ANY($1::uuid[]) GROUP BY 1`, [ids])).map((r) => [r.CycleId, r.count]));
    const results = await this.db.query<{ Id: string; WinnerUserId: string; WinnerSlotNumber: number }>(`SELECT "Id","WinnerUserId","WinnerSlotNumber" FROM groups."SelectionResults" WHERE "Id" = ANY($1::uuid[])`,
      [cycles.map((c) => c.selectionResultId).filter(Boolean)]);
    const names = await authRepository.directoryMany(this.db, results.map((r) => r.WinnerUserId));
    return cycles.map((c) => {
      const financial = c.collectionMode === "Razorpay";
      const settled = financial ? c.financiallySettledMemberCount : c.fullyRecordedMemberCount;
      const a = auctions.find((x) => x.CycleId === c.id);
      const r = c.selectionResultId ? results.find((x) => x.Id === c.selectionResultId) : undefined;
      return {
        id: c.id, cycleNumber: c.cycleNumber, status: snakeUpper(c.status), selectionMethod: snakeUpper(c.selectionMethod), collectionMode: snakeUpper(c.collectionMode),
        contributionDueDate: c.contributionDueDate, selectionDate: c.selectionDate, payoutDate: c.payoutDate, expectedMemberCount: c.expectedMemberCount, settledMemberCount: settled,
        outstandingMemberCount: c.expectedMemberCount - settled, expectedPoolAmount: c.expectedPoolAmount, settledAmount: financial ? c.financiallySettledAmount : c.recordedContributionAmount,
        manualRecordedMemberCount: c.fullyRecordedMemberCount, manualRecordedAmount: c.recordedContributionAmount, startedAt: c.startedAt, readyForSelectionAt: c.readyForSelectionAt,
        selectionCompletedAt: c.selectionCompletedAt, completedAt: c.completedAt, selectionResultId: c.selectionResultId,
        winnerName: r ? (names.get(r.WinnerUserId)?.name ?? "Member") : null, winnerSlotNumber: r?.WinnerSlotNumber ?? null,
        auctionStatus: a ? snakeUpper(a.Status as string) : null, auctionStartsAt: (a?.StartsAt as Date | undefined) ?? null, auctionEndsAt: (a?.EndsAt as Date | undefined) ?? null,
        auctionBidCount: bids.get(c.id) ?? 0, auctionRescheduleCount: (a?.RescheduleCount as number | undefined) ?? 0,
      };
    });
  }

  private async outstanding(groupId: string, cycleId: string) {
    const cycle = await cycleRepository.cycle(this.db, groupId, cycleId);
    if (!cycle) return [];
    const financial = cycle.collectionMode === "Razorpay";
    const rows = (await this.db.query(`SELECT * FROM groups."Contributions" WHERE "CycleId" = $1 AND "GroupId" = $2 AND ${financial ? `"FinanciallySettledAmount"` : `"RecordedAmount"`} < "ExpectedAmount"`,
      [cycleId, groupId])).map(mapContribution);
    const memberships = await groupRepository.membershipsByIds(this.db, rows.map((r) => r.membershipId));
    const names = await authRepository.directoryMany(this.db, [...memberships.values()].map((m) => m.userId));
    return rows.sort((a, b) => (memberships.get(a.membershipId)!.slotNumber ?? 0) - (memberships.get(b.membershipId)!.slotNumber ?? 0)).map((r) => {
      const m = memberships.get(r.membershipId)!;
      return { contributionId: r.id, membershipId: r.membershipId, memberName: names.get(m.userId)?.name ?? "Member", slotNumber: m.slotNumber, expectedAmount: r.expectedAmount,
        settledAmount: r.financiallySettledAmount, manualRecordedAmount: r.recordedAmount, status: snakeUpper(r.status), financialStatus: snakeUpper(r.financialStatus), dueDate: r.dueDate };
    });
  }

  private async groupPayouts(groupId: string) {
    const rows = await this.db.query<Record<string, unknown>>(`SELECT * FROM payouts."PayoutObligations" WHERE "GroupId" = $1 ORDER BY "CycleNumber" DESC, "PayoutType", "CreatedAt" LIMIT 200`, [groupId]);
    const approvable = new Set((await this.db.query<{ Id: string }>(`SELECT p."Id" FROM payouts."PayoutObligations" p WHERE ${this.approvable} AND p."GroupId" = $2`, [this.clock.now(), groupId])).map((r) => r.Id));
    return rows.map((p) => ({
      id: p.Id as string, cycleId: p.CycleId, cycleNumber: p.CycleNumber as number, payoutType: snakeUpper(p.PayoutType as string), membershipId: p.MembershipId, memberName: p.MemberName as string,
      amount: p.Amount, status: p.Status === "PendingBeneficiary" && approvable.has(p.Id as string) ? "APPROVAL_REQUIRED" : snakeUpper(p.Status as string),
      hasBeneficiary: p.BeneficiaryId !== null || p.PayoutType === "PlatformFeeSettlement" || approvable.has(p.Id as string), createdAt: p.CreatedAt as Date, approvedAt: p.ApprovedAt, settledAt: p.SettledAt,
    }));
  }

  private async groupActivity(groupId: string, limit: number) {
    const events = await this.db.query<{ Id: string; CreatedAt: Date; Action: string; ActorUserId: string; SubjectId: string | null; CycleId: string | null }>(
      `SELECT "Id","CreatedAt","Action","ActorUserId","SubjectId","CycleId" FROM groups."GroupAuditEvents" WHERE "GroupId" = $1 ORDER BY "CreatedAt" DESC, "Id" DESC LIMIT $2`, [groupId, clamp(limit, 1, 200)]);
    const actors = await authRepository.directoryMany(this.db, events.map((e) => e.ActorUserId));
    return events.map((e) => ({ id: e.Id, at: e.CreatedAt, source: "GROUP", action: e.Action, actorName: actors.get(e.ActorUserId)?.name ?? null, message: null, subjectId: e.SubjectId, cycleId: e.CycleId }));
  }

  private async payoutActivity(groupId: string, limit: number) {
    const rows = await this.db.query<{ Id: string; CreatedAt: Date; Action: string; Message: string; PayoutObligationId: string; CycleId: string }>(
      `SELECT h."Id", h."CreatedAt", h."Action", h."Message", h."PayoutObligationId", p."CycleId" FROM payouts."PayoutReconciliationHistory" h JOIN payouts."PayoutObligations" p ON p."Id" = h."PayoutObligationId"
       WHERE p."GroupId" = $1 ORDER BY h."CreatedAt" DESC LIMIT $2`, [groupId, clamp(limit, 1, 200)]);
    return rows.map((h) => ({ id: h.Id, at: h.CreatedAt, source: "PAYOUT", action: h.Action, actorName: null, message: h.Message, subjectId: h.PayoutObligationId, cycleId: h.CycleId }));
  }

  /** Blocking conditions for one group and who must resolve them. */
  private issues(g: Awaited<ReturnType<AdminOperationsService["rows"]>>[number], outstanding: Awaited<ReturnType<AdminOperationsService["outstanding"]>>,
    payouts: Awaited<ReturnType<AdminOperationsService["groupPayouts"]>>, paymentIssues: Array<{ id: unknown; cycleNumber: unknown; memberName: unknown; status: string; reconciliationMessage: unknown; createdAt: unknown }>) {
    const issues: Array<{ kind: string; title: string; detail: string; responsibleRole: string; since: Date | null; referenceType: string | null; referenceId: string | null }> = [];
    const today = businessToday(this.clock.now());
    if (g.status === "SUSPENDED") issues.push({ kind: "GROUP_SUSPENDED", title: "Group suspended", detail: g.statusReason ?? "Contributions, selections and bids are paused.", responsibleRole: "ADMIN", since: g.lastActivityAt, referenceType: "GROUP", referenceId: g.id });
    for (const p of paymentIssues.filter((x) => x.status === "RECONCILIATION_REQUIRED"))
      issues.push({ kind: "PAYMENT_RECONCILIATION", title: `Payment reconciliation mismatch · cycle ${p.cycleNumber}`, detail: (p.reconciliationMessage as string | null) ?? `${p.memberName}'s payment does not match provider data.`, responsibleRole: "FINANCE", since: p.createdAt as Date, referenceType: "PAYMENT", referenceId: p.id as string });
    for (const p of payouts.filter((x) => x.status === "RECONCILIATION_REQUIRED"))
      issues.push({ kind: "PAYOUT_RECONCILIATION", title: `Payout reconciliation mismatch · cycle ${p.cycleNumber}`, detail: `${p.memberName}'s payout does not match provider data. Settlement and retries are blocked.`, responsibleRole: "FINANCE", since: p.createdAt, referenceType: "PAYOUT", referenceId: p.id });
    for (const p of payouts.filter((x) => x.status === "FAILED"))
      issues.push({ kind: "PAYOUT_FAILED", title: `Payout failed · cycle ${p.cycleNumber}`, detail: `The transfer to ${p.memberName} failed and can be retried.`, responsibleRole: "FINANCE", since: p.createdAt, referenceType: "PAYOUT", referenceId: p.id });
    for (const p of payouts.filter((x) => x.status === "PENDING_BENEFICIARY"))
      issues.push({ kind: "MISSING_BENEFICIARY", title: `Missing payout account · cycle ${p.cycleNumber}`, detail: `${p.memberName} has not added a payout bank account.`, responsibleRole: "USER", since: p.createdAt, referenceType: "PAYOUT", referenceId: p.id });
    const c = g.currentCycle;
    if (c) {
      if (c.auctionStatus === "CLOSED_NO_BIDS") issues.push({ kind: "AUCTION_NO_BIDS", title: `Auction closed without bids · cycle ${c.cycleNumber}`, detail: "No winner or payout right was assigned. The cycle needs review.", responsibleRole: g.creatorType === "PLATFORM" ? "ADMIN" : "ORGANIZER", since: c.auctionEndsAt, referenceType: "CYCLE", referenceId: c.id });
      const overdue = outstanding.filter((o) => o.status === "OVERDUE" || o.dueDate < today);
      if (c.status === "COLLECTING_CONTRIBUTIONS" && overdue.length > 0)
        issues.push({ kind: "OUTSTANDING_CONTRIBUTIONS", title: `${overdue.length} contribution${overdue.length === 1 ? "" : "s"} overdue · cycle ${c.cycleNumber}`,
          detail: overdue.slice(0, 5).map((o) => (o.slotNumber !== null ? `#${o.slotNumber} ${o.memberName}` : o.memberName)).join(", ") + (overdue.length > 5 ? ` and ${overdue.length - 5} more` : ""),
          responsibleRole: c.collectionMode === "RAZORPAY" ? "USER" : g.creatorType === "PLATFORM" ? "ADMIN" : "ORGANIZER", since: dateOnlyMidnightUtc(c.contributionDueDate), referenceType: "CYCLE", referenceId: c.id });
    }
    return issues;
  }
}

