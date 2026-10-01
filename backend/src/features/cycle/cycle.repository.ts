import { snapshot, type Snapshot, updateChanged } from "../../infra/database/changes.js";
import type { Queryable, Row } from "../../infra/database/db.js";
import type { Contribution, ContributionEntry } from "../contribution/contribution.domain.js";
import type { MonthlyCycle } from "./cycle.domain.js";

const mapCycle = (r: Row): MonthlyCycle => ({
  id: r.Id as string, groupId: r.GroupId as string, cycleNumber: r.CycleNumber as number, selectionMethod: r.SelectionMethod as MonthlyCycle["selectionMethod"],
  contributionDueDate: r.ContributionDueDate as string, selectionDate: r.SelectionDate as string, payoutDate: r.PayoutDate as string,
  expectedMemberCount: r.ExpectedMemberCount as number, expectedContributionPerMember: r.ExpectedContributionPerMember as MonthlyCycle["expectedPoolAmount"],
  expectedPoolAmount: r.ExpectedPoolAmount as MonthlyCycle["expectedPoolAmount"], recordedContributionAmount: r.RecordedContributionAmount as MonthlyCycle["expectedPoolAmount"],
  fullyRecordedMemberCount: r.FullyRecordedMemberCount as number, financiallySettledAmount: r.FinanciallySettledAmount as MonthlyCycle["expectedPoolAmount"],
  financiallySettledMemberCount: r.FinanciallySettledMemberCount as number, collectionMode: r.CollectionMode as MonthlyCycle["collectionMode"], status: r.Status as MonthlyCycle["status"],
  startedAt: r.StartedAt as Date | null, contributionsCompletedAt: r.ContributionsCompletedAt as Date | null, readyForSelectionAt: r.ReadyForSelectionAt as Date | null,
  selectionCompletedAt: r.SelectionCompletedAt as Date | null, selectionResultId: r.SelectionResultId as string | null, payoutCompletedAt: r.PayoutCompletedAt as Date | null,
  completedAt: r.CompletedAt as Date | null, createdAt: r.CreatedAt as Date, updatedAt: r.UpdatedAt as Date, version: r.Version as number,
});

const cycleColumns = (c: MonthlyCycle) => ({
  Status: c.status, RecordedContributionAmount: c.recordedContributionAmount, FullyRecordedMemberCount: c.fullyRecordedMemberCount,
  FinanciallySettledAmount: c.financiallySettledAmount, FinanciallySettledMemberCount: c.financiallySettledMemberCount, StartedAt: c.startedAt,
  ContributionsCompletedAt: c.contributionsCompletedAt, ReadyForSelectionAt: c.readyForSelectionAt, SelectionCompletedAt: c.selectionCompletedAt,
  SelectionResultId: c.selectionResultId, PayoutCompletedAt: c.payoutCompletedAt, CompletedAt: c.completedAt, UpdatedAt: c.updatedAt, Version: c.version,
});

export const mapContribution = (r: Row): Contribution => ({
  id: r.Id as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, membershipId: r.MembershipId as string,
  expectedAmount: r.ExpectedAmount as Contribution["expectedAmount"], recordedAmount: r.RecordedAmount as Contribution["expectedAmount"],
  financiallySettledAmount: r.FinanciallySettledAmount as Contribution["expectedAmount"], financialStatus: r.FinancialStatus as Contribution["financialStatus"],
  settledPaymentId: r.SettledPaymentId as string | null, status: r.Status as Contribution["status"], dueDate: r.DueDate as string,
  recordedAt: r.RecordedAt as Date | null, overdueAt: r.OverdueAt as Date | null, createdAt: r.CreatedAt as Date, updatedAt: r.UpdatedAt as Date, version: r.Version as number,
});

const contributionColumns = (c: Contribution) => ({
  RecordedAmount: c.recordedAmount, FinanciallySettledAmount: c.financiallySettledAmount, FinancialStatus: c.financialStatus, SettledPaymentId: c.settledPaymentId,
  Status: c.status, RecordedAt: c.recordedAt, OverdueAt: c.overdueAt, UpdatedAt: c.updatedAt, Version: c.version,
});

export const mapEntry = (r: Row): ContributionEntry => ({
  id: r.Id as string, contributionId: r.ContributionId as string, entryType: r.EntryType as ContributionEntry["entryType"], amount: r.Amount as ContributionEntry["amount"],
  reference: r.Reference as string, idempotencyKey: r.IdempotencyKey as string, recordedByUserId: r.RecordedByUserId as string, note: r.Note as string | null,
  createdAt: r.CreatedAt as Date, reversesEntryId: r.ReversesEntryId as string | null,
});

export const cycleRepository = {
  async cycles(db: Queryable, groupId: string, lock = false): Promise<MonthlyCycle[]> {
    return (await db.query(`SELECT * FROM groups."MonthlyCycles" WHERE "GroupId" = $1 ORDER BY "CycleNumber"${lock ? " FOR UPDATE" : ""}`, [groupId])).map(mapCycle);
  },
  async cycle(db: Queryable, groupId: string, cycleId: string, lock = false): Promise<MonthlyCycle | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."MonthlyCycles" WHERE "GroupId" = $1 AND "Id" = $2${lock ? " FOR UPDATE" : ""}`, [groupId, cycleId]);
    return r && mapCycle(r);
  },
  async cycleById(db: Queryable, cycleId: string): Promise<MonthlyCycle | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."MonthlyCycles" WHERE "Id" = $1`, [cycleId]);
    return r && mapCycle(r);
  },
  async cyclesByIds(db: Queryable, ids: string[]): Promise<Map<string, MonthlyCycle>> {
    if (ids.length === 0) return new Map();
    return new Map((await db.query(`SELECT * FROM groups."MonthlyCycles" WHERE "Id" = ANY($1::uuid[])`, [[...new Set(ids)]])).map((r) => { const c = mapCycle(r); return [c.id, c]; }));
  },
  async cycleCount(db: Queryable, groupId: string): Promise<number> {
    return (await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."MonthlyCycles" WHERE "GroupId" = $1`, [groupId])).count;
  },
  async insertCycle(db: Queryable, c: MonthlyCycle): Promise<void> {
    await db.execute(`INSERT INTO groups."MonthlyCycles" ("Id","GroupId","CycleNumber","SelectionMethod","ContributionDueDate","SelectionDate","PayoutDate","ExpectedMemberCount",
      "ExpectedContributionPerMember","ExpectedPoolAmount","RecordedContributionAmount","FullyRecordedMemberCount","Status","StartedAt","ContributionsCompletedAt","ReadyForSelectionAt",
      "CreatedAt","UpdatedAt","Version","SelectionCompletedAt","SelectionResultId","CollectionMode","FinanciallySettledAmount","FinanciallySettledMemberCount","CompletedAt","PayoutCompletedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [c.id, c.groupId, c.cycleNumber, c.selectionMethod, c.contributionDueDate, c.selectionDate, c.payoutDate, c.expectedMemberCount, c.expectedContributionPerMember.toFixed(),
        c.expectedPoolAmount.toFixed(), c.recordedContributionAmount.toFixed(), c.fullyRecordedMemberCount, c.status, c.startedAt, c.contributionsCompletedAt, c.readyForSelectionAt,
        c.createdAt, c.updatedAt, c.version, c.selectionCompletedAt, c.selectionResultId, c.collectionMode, c.financiallySettledAmount.toFixed(), c.financiallySettledMemberCount,
        c.completedAt, c.payoutCompletedAt]);
  },
  cycleSnapshot: (c: MonthlyCycle): Snapshot => snapshot(cycleColumns(c)),
  async saveCycle(db: Queryable, c: MonthlyCycle, before: Snapshot): Promise<void> {
    await updateChanged(db, `groups."MonthlyCycles"`, c.id, before, cycleColumns(c));
  },

  async contributions(db: Queryable, where: { groupId?: string; cycleId?: string; membershipId?: string }, lock = false): Promise<Contribution[]> {
    const conditions: string[] = []; const params: unknown[] = [];
    if (where.groupId) { params.push(where.groupId); conditions.push(`"GroupId" = $${params.length}`); }
    if (where.cycleId) { params.push(where.cycleId); conditions.push(`"CycleId" = $${params.length}`); }
    if (where.membershipId) { params.push(where.membershipId); conditions.push(`"MembershipId" = $${params.length}`); }
    return (await db.query(`SELECT * FROM groups."Contributions" WHERE ${conditions.join(" AND ")} ORDER BY "DueDate", "Id"${lock ? " FOR UPDATE" : ""}`, params)).map(mapContribution);
  },
  async contribution(db: Queryable, id: string, lock = false): Promise<Contribution | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."Contributions" WHERE "Id" = $1${lock ? " FOR UPDATE" : ""}`, [id]);
    return r && mapContribution(r);
  },
  async contributionCount(db: Queryable, groupId: string): Promise<number> {
    return (await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."Contributions" WHERE "GroupId" = $1`, [groupId])).count;
  },
  async insertContribution(db: Queryable, c: Contribution): Promise<void> {
    await db.execute(`INSERT INTO groups."Contributions" ("Id","GroupId","CycleId","MembershipId","ExpectedAmount","RecordedAmount","Status","DueDate","RecordedAt","OverdueAt",
      "CreatedAt","UpdatedAt","Version","FinancialStatus","FinanciallySettledAmount","SettledPaymentId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.id, c.groupId, c.cycleId, c.membershipId, c.expectedAmount.toFixed(), c.recordedAmount.toFixed(), c.status, c.dueDate, c.recordedAt, c.overdueAt, c.createdAt, c.updatedAt,
        c.version, c.financialStatus, c.financiallySettledAmount.toFixed(), c.settledPaymentId]);
  },
  contributionSnapshot: (c: Contribution): Snapshot => snapshot(contributionColumns(c)),
  async saveContribution(db: Queryable, c: Contribution, before: Snapshot): Promise<void> {
    await updateChanged(db, `groups."Contributions"`, c.id, before, contributionColumns(c));
  },

  async entries(db: Queryable, contributionIds: string[]): Promise<ContributionEntry[]> {
    if (contributionIds.length === 0) return [];
    return (await db.query(`SELECT * FROM groups."ContributionEntries" WHERE "ContributionId" = ANY($1::uuid[]) ORDER BY "CreatedAt", "Id"`, [contributionIds])).map(mapEntry);
  },
  async entry(db: Queryable, id: string): Promise<ContributionEntry | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."ContributionEntries" WHERE "Id" = $1`, [id]);
    return r && mapEntry(r);
  },
  async referenceUsed(db: Queryable, contributionId: string, reference: string): Promise<boolean> {
    return (await db.maybeOne(`SELECT 1 FROM groups."ContributionEntries" WHERE "ContributionId" = $1 AND "EntryType" = 'Record' AND "Reference" = $2`, [contributionId, reference])) !== null;
  },
  async isReversed(db: Queryable, entryId: string): Promise<boolean> {
    return (await db.maybeOne(`SELECT 1 FROM groups."ContributionEntries" WHERE "ReversesEntryId" = $1`, [entryId])) !== null;
  },
  async insertEntry(db: Queryable, e: ContributionEntry): Promise<void> {
    await db.execute(`INSERT INTO groups."ContributionEntries" ("Id","ContributionId","EntryType","Amount","Reference","IdempotencyKey","RecordedByUserId","Note","CreatedAt","ReversesEntryId")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.id, e.contributionId, e.entryType, e.amount.toFixed(), e.reference, e.idempotencyKey, e.recordedByUserId, e.note, e.createdAt, e.reversesEntryId]);
  },
};
