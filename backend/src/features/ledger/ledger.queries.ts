import type { Database, Queryable } from "../../infra/database/db.js";
import { compareDateOnly, type DateOnly } from "../../utils/dates.js";
import { snakeUpper } from "../../utils/enums.js";
import { NotFoundError, requireRule } from "../../utils/errors.js";
import { Decimal, sum } from "../../utils/money.js";
import { type AccountingEventType, type AccountType, balanceOf, type NormalBalance } from "./ledger.domain.js";

export interface LedgerFilter {
  from?: DateOnly; to?: DateOnly; eventType?: AccountingEventType; account?: string; groupId?: string; cycleId?: string; journalNumber?: string; page: number; pageSize: number;
}

/** Port of LedgerQueries. Multi-statement reads run in REPEATABLE READ so counts and pages are consistent. */
export class LedgerQueries {
  constructor(private readonly db: Database) {}

  private async validate(f: LedgerFilter): Promise<void> {
    requireRule(f.page >= 1 && f.page <= 1_000_000 && f.pageSize >= 1 && f.pageSize <= 100 && (!f.from || !f.to || compareDateOnly(f.from, f.to) <= 0) &&
      (f.journalNumber?.length ?? 0) <= 40 && (f.account?.length ?? 0) <= 20, "INVALID_LEDGER_FILTER", "Use a valid date range, page, event type and account filter.");
    if (f.groupId && !(await this.db.maybeOne(`SELECT 1 FROM groups."Groups" WHERE "Id" = $1`, [f.groupId]))) throw new NotFoundError("Group not found.");
  }

  private filter(f: LedgerFilter, params: unknown[]): string {
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (f.from) w.push(`j."BusinessDate" >= ${p(f.from)}::date`);
    if (f.to) w.push(`j."BusinessDate" <= ${p(f.to)}::date`);
    if (f.eventType) w.push(`j."EventType" = ${p(f.eventType)}`);
    if (f.journalNumber?.trim()) w.push(`j."JournalNumber" = ${p(f.journalNumber)}`);
    if (f.groupId) w.push(`EXISTS (SELECT 1 FROM ledger."JournalLines" l WHERE l."JournalEntryId" = j."Id" AND l."GroupId" = ${p(f.groupId)})`);
    if (f.cycleId) w.push(`EXISTS (SELECT 1 FROM ledger."JournalLines" l WHERE l."JournalEntryId" = j."Id" AND l."CycleId" = ${p(f.cycleId)})`);
    if (f.account?.trim()) w.push(`EXISTS (SELECT 1 FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId" WHERE l."JournalEntryId" = j."Id" AND a."Code" = ${p(f.account)})`);
    return w.length ? `WHERE ${w.join(" AND ")}` : "";
  }

  async accounts(db: Queryable = this.db) {
    const rows = await db.query<{ Id: string; Code: string; Name: string; AccountType: AccountType; NormalBalance: NormalBalance; IsSystem: boolean; IsActive: boolean }>(
      `SELECT * FROM ledger."LedgerAccounts" ORDER BY "Code"`);
    return rows.map((a) => ({ id: a.Id, code: a.Code, name: a.Name, accountType: snakeUpper(a.AccountType), normalBalance: snakeUpper(a.NormalBalance), isSystem: a.IsSystem, isActive: a.IsActive,
      raw: { type: a.AccountType, normal: a.NormalBalance } }));
  }

  private summary = `SELECT j."Id", j."JournalNumber", j."BusinessDate", j."BusinessTimeZone", j."EventType", j."Description", j."SourceModule", j."Status", j."PostedAt", j."DebitTotal", j."CreditTotal",
    (SELECT l."GroupId" FROM ledger."JournalLines" l WHERE l."JournalEntryId" = j."Id" LIMIT 1) AS "GroupId" FROM ledger."JournalEntries" j`;

  private mapSummary = (r: Record<string, unknown>) => ({
    id: r.Id, journalNumber: r.JournalNumber, businessDate: r.BusinessDate, businessTimeZone: r.BusinessTimeZone, eventType: snakeUpper(r.EventType as string),
    description: r.Description, sourceModule: r.SourceModule, status: r.Status, postedAt: r.PostedAt, debitTotal: r.DebitTotal, creditTotal: r.CreditTotal, groupId: r.GroupId ?? null,
  });

  async journals(f: LedgerFilter) {
    await this.validate(f);
    return this.db.transaction(async (tx) => {
      const params: unknown[] = [];
      const where = this.filter(f, params);
      const total = (await tx.one<{ count: number }>(`SELECT count(*)::int AS count FROM ledger."JournalEntries" j ${where}`, params)).count;
      const rows = await tx.query(`${this.summary} ${where} ORDER BY j."PostedAt" DESC, j."JournalNumber" DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params);
      return { items: rows.map(this.mapSummary), totalCount: total, page: f.page, pageSize: f.pageSize };
    }, "REPEATABLE READ");
  }

  async journal(id: string) {
    return this.db.transaction(async (tx) => {
      const j = await tx.maybeOne<Record<string, unknown>>(`SELECT * FROM ledger."JournalEntries" WHERE "Id" = $1`, [id]);
      if (!j) throw new NotFoundError("Journal not found.");
      const summary = this.mapSummary((await tx.one(`${this.summary} WHERE j."Id" = $1`, [id])) as Record<string, unknown>);
      const reversedBy = await tx.maybeOne<{ Id: string }>(`SELECT "Id" FROM ledger."JournalEntries" WHERE "ReversesJournalEntryId" = $1`, [id]);
      const lines = await tx.query<Record<string, unknown>>(`SELECT l.*, a."Code", a."Name" FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId"
        WHERE l."JournalEntryId" = $1 ORDER BY a."Code", l."MembershipId" NULLS FIRST, l."Id"`, [id]);
      return {
        journal: summary, eventId: j.EventId, policyVersion: j.PolicyVersion, feePolicy: snakeUpper(j.FeePolicy as string), postedBy: j.PostedBy, correlationId: j.CorrelationId,
        reversesJournalEntryId: j.ReversesJournalEntryId, reversedByJournalEntryId: reversedBy?.Id ?? null, reversalReason: j.ReversalReason,
        lines: lines.map((l) => ({ id: l.Id, accountCode: l.Code, accountName: l.Name, debitAmount: l.DebitAmount, creditAmount: l.CreditAmount, currency: l.Currency, groupId: l.GroupId,
          cycleId: l.CycleId, membershipId: l.MembershipId, selectionResultId: l.SelectionResultId, auctionResultId: l.AuctionResultId, referenceType: l.ReferenceType,
          referenceId: l.ReferenceId, description: l.Description })),
      };
    }, "REPEATABLE READ");
  }

  async trialBalance(f: LedgerFilter) {
    await this.validate(f);
    return this.db.transaction(async (tx) => {
      const params: unknown[] = [];
      const where = this.filter(f, params);
      const sums = await tx.query<{ AccountId: string; debit: Decimal; credit: Decimal }>(
        `SELECT l."AccountId", sum(l."DebitAmount")::numeric AS debit, sum(l."CreditAmount")::numeric AS credit FROM ledger."JournalLines" l
         WHERE l."JournalEntryId" IN (SELECT j."Id" FROM ledger."JournalEntries" j ${where}) GROUP BY l."AccountId"`, params);
      const byAccount = new Map(sums.map((s) => [s.AccountId, s]));
      const accounts = (await this.accounts(tx)).map((a) => {
        const s = byAccount.get(a.id); const debit = s?.debit ?? new Decimal(0); const credit = s?.credit ?? new Decimal(0);
        return { code: a.code, name: a.name, accountType: a.accountType, normalBalance: a.normalBalance, currency: "INR", debitTotal: debit, creditTotal: credit,
          balance: balanceOf(a.raw.normal, debit, credit) };
      });
      const count = (await tx.one<{ count: number }>(`SELECT count(*)::int AS count FROM ledger."JournalEntries" j ${where}`, params)).count;
      const debits = sum(accounts.map((a) => a.debitTotal)); const credits = sum(accounts.map((a) => a.creditTotal));
      return { accounts, totalDebits: debits, totalCredits: credits, balanced: debits.eq(credits), totalJournals: count };
    }, "REPEATABLE READ");
  }

  /** Member view: only this user's membership lines; never other members' or platform lines of a shared journal. */
  async member(userId: string, f: LedgerFilter) {
    await this.validate(f);
    const memberships = (await this.db.query<{ Id: string }>(`SELECT "Id" FROM groups."GroupMemberships" WHERE "UserId" = $1`, [userId])).map((m) => m.Id);
    return this.db.transaction(async (tx) => {
      const params: unknown[] = [memberships];
      const where = this.filter(f, params);
      const from = `FROM ledger."JournalLines" l JOIN (SELECT j.* FROM ledger."JournalEntries" j ${where}) j ON j."Id" = l."JournalEntryId"
        JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId" WHERE l."MembershipId" = ANY($1::uuid[])`;
      const total = (await tx.one<{ count: number }>(`SELECT count(*)::int AS count ${from}`, params)).count;
      const rows = await tx.query<Record<string, unknown>>(`SELECT l."Id", j."JournalNumber", j."BusinessDate", j."PostedAt", j."ReversesJournalEntryId", a."Code", a."NormalBalance",
          l."DebitAmount", l."CreditAmount", l."Currency", l."GroupId", l."CycleId", l."ReferenceType", l."ReferenceId" ${from}
        ORDER BY j."PostedAt" DESC, j."JournalNumber" DESC, l."Id" LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params);
      return {
        items: rows.map((r) => ({
          id: r.Id, journalNumber: r.JournalNumber, businessDate: r.BusinessDate, postedAt: r.PostedAt,
          description: r.ReversesJournalEntryId ? "Accounting correction" : "Calculated entitlement recorded",
          accountName: r.Code === "2100" ? "Payout entitlement" : r.Code === "2200" ? "Auction benefit entitlement" : "Financial activity",
          increase: r.NormalBalance === "Debit" ? r.DebitAmount : r.CreditAmount, decrease: r.NormalBalance === "Debit" ? r.CreditAmount : r.DebitAmount,
          currency: r.Currency, groupId: r.GroupId, cycleId: r.CycleId, referenceType: r.ReferenceType, referenceId: r.ReferenceId,
        })),
        totalCount: total, page: f.page, pageSize: f.pageSize,
      };
    }, "REPEATABLE READ");
  }
}
