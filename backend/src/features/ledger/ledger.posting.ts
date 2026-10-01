import type { FeeRecognitionPolicy } from "../../config/payment.js";
import type { Queryable, Tx } from "../../infra/database/db.js";
import type { Clock } from "../../types/common.types.js";
import { newId, sha256HexLower } from "../../utils/crypto.js";
import { BusinessRuleError, NotFoundError, requireRule } from "../../utils/errors.js";
import { Decimal } from "../../utils/money.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { Accounts, type AccountingEventType, type JournalEntry, type JournalLineInput, planPosting, postJournal } from "./ledger.domain.js";
import { lockGroup, readCapturedPayment, readLedgerSource, readSettledPayout } from "./ledger.sources.js";

export interface PostingOutcome { status: "POSTED" | "DEFERRED" | "FUNDED"; journalId: string | null; reason: string | null; replayed?: boolean }

/**
 * Port of LedgerPostingService. Always runs inside the caller's transaction so the business change, its journal
 * and its audit row commit together. Idempotent per (EventType, EventId): a replay returns the existing journal
 * only when the recomputed source fingerprint matches (LEDGER_EVENT_REUSED otherwise). Database triggers keep
 * posted history append-only and every journal balanced.
 */
export class LedgerPostingService {
  constructor(private readonly clock: Clock, private readonly feePolicy: FeeRecognitionPolicy) {}

  private async accounts(db: Queryable): Promise<Map<string, string>> {
    const rows = await db.query<{ Id: string; Code: string }>(`SELECT "Id","Code" FROM ledger."LedgerAccounts" WHERE "IsActive"`);
    return new Map(rows.map((r) => [r.Code, r.Id]));
  }

  private account(accounts: Map<string, string>, code: string): string {
    const id = accounts.get(code);
    if (!id) throw new Error("Required ledger account is inactive or missing.");
    return id;
  }

  private async existing(db: Queryable, type: AccountingEventType, eventId: string) {
    return db.maybeOne<{ Id: string; SourceFingerprint: string }>(`SELECT "Id","SourceFingerprint" FROM ledger."JournalEntries" WHERE "EventType" = $1 AND "EventId" = $2`, [type, eventId]);
  }

  /** Global sequence; gaps after rolled-back postings are intentional. */
  private async number(db: Queryable): Promise<string> {
    const r = await db.one<{ value: number }>(`SELECT nextval('ledger."JournalNumberSequence"') AS value`);
    return `JRN-${String(r.value).padStart(12, "0")}`;
  }

  private async persist(db: Queryable, j: JournalEntry, action: string): Promise<void> {
    await db.execute(`INSERT INTO ledger."JournalEntries" ("Id","JournalNumber","EventType","EventId","Description","BusinessDate","BusinessTimeZone","PostedAt","PostedBy","Status",
      "CorrelationId","IdempotencyKey","SourceModule","SourceFingerprint","PolicyVersion","FeePolicy","CreatedAt","ReversesJournalEntryId","ReversalReason","LineCount","DebitTotal","CreditTotal")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [j.id, j.journalNumber, j.eventType, j.eventId, j.description, j.businessDate, j.businessTimeZone, j.postedAt, j.postedBy, j.status, j.correlationId, j.idempotencyKey,
        j.sourceModule, j.sourceFingerprint, j.policyVersion, j.feePolicy, j.createdAt, j.reversesJournalEntryId, j.reversalReason, j.lineCount, j.debitTotal.toFixed(2), j.creditTotal.toFixed(2)]);
    for (const l of j.lines)
      await db.execute(`INSERT INTO ledger."JournalLines" ("Id","JournalEntryId","AccountId","DebitAmount","CreditAmount","Currency","GroupId","CycleId","MembershipId","SelectionResultId",
        "AuctionResultId","ReferenceType","ReferenceId","Description","CreatedAt","ContributionId","PaymentId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [l.id, j.id, l.accountId, l.debitAmount.toFixed(2), l.creditAmount.toFixed(2), l.currency, l.groupId, l.cycleId, l.membershipId, l.selectionResultId, l.auctionResultId,
          l.referenceType, l.referenceId, l.description, l.createdAt, l.contributionId ?? null, l.paymentId ?? null]);
    await writeAuditLog(db, { actorUserId: j.postedBy, action, entityType: "JournalEntry", entityId: j.id, timestamp: j.postedAt, correlationId: j.correlationId });
  }

  /** Trusted application contract only; there is deliberately no HTTP posting endpoint. */
  async post(tx: Tx, type: AccountingEventType, eventId: string, actor: string, correlationId: string | null = null): Promise<PostingOutcome> {
    const source = await readLedgerSource(tx, type, eventId);
    const existing = await this.existing(tx, source.eventType, source.eventId);
    if (existing) {
      requireRule(existing.SourceFingerprint === source.fingerprint, "LEDGER_EVENT_REUSED", "Source event differs from its posted journal.");
      return { status: "POSTED", journalId: existing.Id, reason: null, replayed: true };
    }
    const accounts = await this.accounts(tx);
    const pool = await tx.one<{ balance: Decimal }>(`SELECT COALESCE(sum("CreditAmount" - "DebitAmount"), 0)::numeric AS balance FROM ledger."JournalLines"
      WHERE "AccountId" = $1 AND "GroupId" = $2 AND "CycleId" = $3 AND "Currency" = 'INR'`, [this.account(accounts, Accounts.GroupPool), source.groupId, source.cycleId]);
    const plan = planPosting(source, pool.balance, this.feePolicy);
    if (plan.deferredReason) return { status: "DEFERRED", journalId: null, reason: plan.deferredReason };
    const lines: JournalLineInput[] = plan.lines.map((l) => ({
      accountId: this.account(accounts, l.accountCode), debitAmount: l.debit, creditAmount: l.credit, currency: "INR", groupId: source.groupId, cycleId: source.cycleId,
      membershipId: l.membershipId, selectionResultId: source.selectionResultId, auctionResultId: source.auctionResultId,
      referenceType: source.auctionResultId ? "AuctionResult" : "SelectionResult", referenceId: source.auctionResultId ?? source.eventId, description: "Finalized selection allocation",
    }));
    const journal = postJournal({ id: newId(), number: await this.number(tx), eventType: source.eventType, eventId: source.eventId, sourceModule: source.sourceModule,
      fingerprint: source.fingerprint, description: "Funded pool reclassified to finalized payout rights", timeZone: source.timeZone, occurredAt: source.occurredAt,
      postedAt: this.clock.now(), actor, correlationId, feePolicy: this.feePolicy, lines, newLineId: newId });
    await this.persist(tx, journal, "LEDGER_JOURNAL_POSTED");
    return { status: "POSTED", journalId: journal.id, reason: null };
  }

  /** Payment capture accounting: Dr 1010 Payment gateway clearing / Cr 2000 Group pool liability. */
  async capturePayment(tx: Tx, paymentId: string): Promise<string> {
    const source = await readCapturedPayment(tx, paymentId);
    await lockGroup(tx, source.groupId);
    const existing = await this.existing(tx, "PaymentCaptured", paymentId);
    if (existing) {
      requireRule(existing.SourceFingerprint === source.fingerprint, "LEDGER_EVENT_REUSED", "Capture differs from its posted journal.");
      return existing.Id;
    }
    const accounts = await this.accounts(tx);
    const zero = new Decimal(0);
    const line = (code: string, debit: Decimal, credit: Decimal, member: string | null): JournalLineInput => ({
      accountId: this.account(accounts, code), debitAmount: debit, creditAmount: credit, currency: "INR", groupId: source.groupId, cycleId: source.cycleId, membershipId: member,
      selectionResultId: null, auctionResultId: null, referenceType: "Payment", referenceId: source.paymentId, description: "Verified Razorpay test capture",
      paymentId: source.paymentId, contributionId: source.contributionId,
    });
    const journal = postJournal({ id: newId(), number: await this.number(tx), eventType: "PaymentCaptured", eventId: paymentId, sourceModule: "Payments", fingerprint: source.fingerprint,
      description: "Verified test capture into gateway clearing", timeZone: source.timeZone, occurredAt: source.capturedAt, postedAt: this.clock.now(), actor: source.userId,
      correlationId: null, feePolicy: "Deferred", newLineId: newId,
      lines: [line(Accounts.PaymentGatewayClearing, source.amount, zero, null), line(Accounts.GroupPool, zero, source.amount, source.membershipId)] });
    await this.persist(tx, journal, "LEDGER_JOURNAL_POSTED");
    return journal.id;
  }

  /** A reversal exactly negates the original lines; one reversal per journal; reversals are not reversible. */
  async reverse(tx: Tx, originalJournalId: string, reversalEventId: string, reason: string, actor: string, correlationId: string | null = null): Promise<PostingOutcome> {
    requireRule(!!reversalEventId && !!reason?.trim(), "INVALID_REVERSAL", "A reversal event and reason are required.");
    const original = await tx.maybeOne<{ Id: string; JournalNumber: string; ReversesJournalEntryId: string | null; BusinessTimeZone: string; FeePolicy: FeeRecognitionPolicy }>(
      `SELECT "Id","JournalNumber","ReversesJournalEntryId","BusinessTimeZone","FeePolicy" FROM ledger."JournalEntries" WHERE "Id" = $1`, [originalJournalId]);
    if (!original) throw new NotFoundError("Journal not found.");
    requireRule(original.ReversesJournalEntryId === null, "REVERSAL_OF_REVERSAL_NOT_SUPPORTED", "A reversal cannot itself be reversed by this policy.");
    const lines = await tx.query<{ AccountId: string; DebitAmount: Decimal; CreditAmount: Decimal; Currency: string; GroupId: string | null; CycleId: string | null; MembershipId: string | null;
      SelectionResultId: string | null; AuctionResultId: string | null; ReferenceType: string; ReferenceId: string; Description: string; PaymentId: string | null; ContributionId: string | null }>(
      `SELECT * FROM ledger."JournalLines" WHERE "JournalEntryId" = $1 ORDER BY "Id"`, [originalJournalId]);
    for (const g of [...new Set(lines.map((l) => l.GroupId).filter((x): x is string => !!x))].sort()) await lockGroup(tx, g);
    await tx.advisoryLock(originalJournalId, 0);
    const existing = await tx.maybeOne<{ Id: string; EventId: string; ReversalReason: string | null }>(`SELECT "Id","EventId","ReversalReason" FROM ledger."JournalEntries" WHERE "ReversesJournalEntryId" = $1`, [originalJournalId]);
    if (existing) {
      requireRule(existing.EventId === reversalEventId && existing.ReversalReason === reason.trim(), "JOURNAL_ALREADY_REVERSED", "This journal already has a different reversal.");
      return { status: "POSTED", journalId: existing.Id, reason: null, replayed: true };
    }
    if (await this.existing(tx, "AccountingReversal", reversalEventId)) throw new BusinessRuleError("LEDGER_EVENT_REUSED", "Reversal event is already used.");
    const now = this.clock.now();
    const journal = postJournal({ id: newId(), number: await this.number(tx), eventType: "AccountingReversal", eventId: reversalEventId, sourceModule: "Ledger",
      fingerprint: sha256HexLower(`${originalJournalId.replace(/-/g, "")}\n${reason.trim()}`), description: `Reversal of ${original.JournalNumber}`, timeZone: original.BusinessTimeZone,
      occurredAt: now, postedAt: now, actor, correlationId, feePolicy: original.FeePolicy, reverses: original.Id, reason: reason.trim(), newLineId: newId,
      lines: lines.map((l) => ({ accountId: l.AccountId, debitAmount: l.CreditAmount, creditAmount: l.DebitAmount, currency: l.Currency, groupId: l.GroupId, cycleId: l.CycleId,
        membershipId: l.MembershipId, selectionResultId: l.SelectionResultId, auctionResultId: l.AuctionResultId, referenceType: l.ReferenceType, referenceId: l.ReferenceId,
        description: l.Description, paymentId: l.PaymentId, contributionId: l.ContributionId })) });
    await this.persist(tx, journal, "LEDGER_JOURNAL_REVERSED");
    return { status: "POSTED", journalId: journal.id, reason: null };
  }

  /** The funded selection liability for this payout must exist, be unreversed and cover the amount. */
  async ensurePayoutFunded(tx: Tx, payoutId: string) {
    const s = await readSettledPayout(tx, payoutId);
    await lockGroup(tx, s.groupId);
    const accounts = await this.accounts(tx);
    const accountId = this.account(accounts, s.benefit ? Accounts.MemberBenefit : Accounts.MemberPayout);
    const r = await tx.one<{ allocated: boolean; reversed: boolean; balance: Decimal }>(
      `SELECT EXISTS (SELECT 1 FROM ledger."JournalLines" WHERE "JournalEntryId" = $1 AND "AccountId" = $2 AND "GroupId" = $3 AND "CycleId" = $4 AND "MembershipId" = $5
                AND "SelectionResultId" = $6 AND "CreditAmount" = $7) AS allocated,
              EXISTS (SELECT 1 FROM ledger."JournalEntries" WHERE "ReversesJournalEntryId" = $1) AS reversed,
              (SELECT COALESCE(sum("CreditAmount" - "DebitAmount"), 0)::numeric FROM ledger."JournalLines" WHERE "AccountId" = $2 AND "GroupId" = $3 AND "CycleId" = $4 AND "MembershipId" = $5) AS balance`,
      [s.allocationJournalId, accountId, s.groupId, s.cycleId, s.membershipId, s.selectionResultId, s.amount.toFixed(2)]);
    requireRule(r.allocated && !r.reversed && r.balance.gte(s.amount), "INSUFFICIENT_FUNDED_POOL", "The funded selection liability is insufficient or reversed.");
    return { source: s, accounts };
  }

  /** Reconciled payout settlement: Dr 2100/2200 liability / Cr 1020 Payout gateway clearing. Exactly once per payout. */
  async settlePayout(tx: Tx, payoutId: string): Promise<string> {
    const existing = await this.existing(tx, "PayoutSettled", payoutId);
    if (existing) return existing.Id;
    const { source: s, accounts } = await this.ensurePayoutFunded(tx, payoutId);
    requireRule(s.matchedSuccess, "PAYOUT_RECONCILIATION_REQUIRED", "Authoritative matched provider success is required.");
    const zero = new Decimal(0);
    const line = (code: string, debit: Decimal, credit: Decimal): JournalLineInput => ({
      accountId: this.account(accounts, code), debitAmount: debit, creditAmount: credit, currency: "INR", groupId: s.groupId, cycleId: s.cycleId, membershipId: s.membershipId,
      selectionResultId: s.selectionResultId, auctionResultId: s.auctionResultId, referenceType: "PayoutObligation", referenceId: s.id, description: "Reconciled fake payout settlement",
    });
    const journal = postJournal({ id: newId(), number: await this.number(tx), eventType: "PayoutSettled", eventId: s.id, sourceModule: "Payouts", fingerprint: s.fingerprint,
      description: "Reconciled test payout", timeZone: s.timeZone, occurredAt: s.requestedAt, postedAt: this.clock.now(), actor: s.actor, correlationId: null, feePolicy: "Deferred",
      newLineId: newId, lines: [line(s.benefit ? Accounts.MemberBenefit : Accounts.MemberPayout, s.amount, zero), line(Accounts.PayoutGatewayClearing, zero, s.amount)] });
    await this.persist(tx, journal, "LEDGER_JOURNAL_POSTED");
    return journal.id;
  }
}
