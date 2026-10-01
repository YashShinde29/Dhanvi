import { snapshot, type Snapshot, updateChanged } from "../../infra/database/changes.js";
import type { Queryable, Row } from "../../infra/database/db.js";
import { newId } from "../../utils/crypto.js";
import type { Decimal } from "../../utils/money.js";
import type { Payment } from "./payment.domain.js";

export const mapPayment = (r: Row): Payment => ({
  id: r.Id as string, contributionId: r.ContributionId as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, membershipId: r.MembershipId as string,
  userId: r.UserId as string, groupName: r.GroupName as string, memberName: r.MemberName as string, cycleNumber: r.CycleNumber as number, businessTimeZone: r.BusinessTimeZone as string,
  provider: r.Provider as string, environment: r.Environment as string, providerOrderId: r.ProviderOrderId as string | null, providerPaymentId: r.ProviderPaymentId as string | null,
  amount: r.Amount as Decimal, currency: r.Currency as string, status: r.Status as Payment["status"], attemptNumber: r.AttemptNumber as number, idempotencyKey: r.IdempotencyKey as string,
  receipt: r.Receipt as string, createdAt: r.CreatedAt as Date, updatedAt: r.UpdatedAt as Date, authorizedAt: r.AuthorizedAt as Date | null, capturedAt: r.CapturedAt as Date | null,
  failedAt: r.FailedAt as Date | null, refundedAt: r.RefundedAt as Date | null, settledAt: r.SettledAt as Date | null, journalId: r.JournalId as string | null,
  reversalJournalId: r.ReversalJournalId as string | null, failureCode: r.FailureCode as string | null, failureReason: r.FailureReason as string | null,
  reconciliationStatus: r.ReconciliationStatus as Payment["reconciliationStatus"], lastReconciledAt: r.LastReconciledAt as Date | null,
  reconciliationMessage: r.ReconciliationMessage as string | null, version: r.Version as number,
});

/** Mutable columns only; identity columns are protected by the payment_protected trigger and never rewritten. */
const columns = (p: Payment) => ({
  ProviderOrderId: p.providerOrderId, ProviderPaymentId: p.providerPaymentId, Status: p.status, UpdatedAt: p.updatedAt, AuthorizedAt: p.authorizedAt, CapturedAt: p.capturedAt,
  FailedAt: p.failedAt, RefundedAt: p.refundedAt, SettledAt: p.settledAt, JournalId: p.journalId, ReversalJournalId: p.reversalJournalId, FailureCode: p.failureCode,
  FailureReason: p.failureReason, ReconciliationStatus: p.reconciliationStatus, LastReconciledAt: p.lastReconciledAt, ReconciliationMessage: p.reconciliationMessage, Version: p.version,
});

export const paymentRepository = {
  async find(db: Queryable, id: string, lock = false): Promise<Payment | null> {
    const r = await db.maybeOne(`SELECT * FROM payments."Payments" WHERE "Id" = $1${lock ? " FOR UPDATE" : ""}`, [id]);
    return r && mapPayment(r);
  },
  async findBy(db: Queryable, where: string, params: unknown[]): Promise<Payment | null> {
    const r = await db.maybeOne(`SELECT * FROM payments."Payments" WHERE ${where}`, params);
    return r && mapPayment(r);
  },
  snapshot: (p: Payment): Snapshot => snapshot(columns(p)),
  async insert(db: Queryable, p: Payment): Promise<void> {
    await db.execute(`INSERT INTO payments."Payments" ("Id","ContributionId","GroupId","CycleId","MembershipId","UserId","GroupName","MemberName","CycleNumber","BusinessTimeZone",
      "Provider","Environment","ProviderOrderId","ProviderPaymentId","Amount","Currency","Status","AttemptNumber","IdempotencyKey","Receipt","CreatedAt","UpdatedAt","AuthorizedAt",
      "CapturedAt","FailedAt","RefundedAt","SettledAt","JournalId","ReversalJournalId","FailureCode","FailureReason","ReconciliationStatus","LastReconciledAt","ReconciliationMessage","Version")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
      [p.id, p.contributionId, p.groupId, p.cycleId, p.membershipId, p.userId, p.groupName, p.memberName, p.cycleNumber, p.businessTimeZone, p.provider, p.environment,
        p.providerOrderId, p.providerPaymentId, p.amount.toFixed(2), p.currency, p.status, p.attemptNumber, p.idempotencyKey, p.receipt, p.createdAt, p.updatedAt, p.authorizedAt,
        p.capturedAt, p.failedAt, p.refundedAt, p.settledAt, p.journalId, p.reversalJournalId, p.failureCode, p.failureReason, p.reconciliationStatus, p.lastReconciledAt,
        p.reconciliationMessage, p.version]);
  },
  async save(db: Queryable, p: Payment, before: Snapshot): Promise<Snapshot> {
    await updateChanged(db, `payments."Payments"`, p.id, before, columns(p));
    return snapshot(columns(p));
  },
  async insertHistory(db: Queryable, paymentId: string, actorId: string, action: string, message: string, now: Date): Promise<void> {
    await db.execute(`INSERT INTO payments."PaymentHistory" ("Id","PaymentId","ActorId","Action","Message","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6)`, [newId(), paymentId, actorId, action, message, now]);
  },
  async event(db: Queryable, key: string) {
    return db.maybeOne<{ PayloadHash: string }>(`SELECT "PayloadHash" FROM payments."PaymentProviderEvents" WHERE "EventKey" = $1`, [key]);
  },
  async insertEvent(db: Queryable, e: { key: string; type: string; hash: string; order: string | null; payment: string | null; paymentId: string | null; status: string; now: Date }): Promise<void> {
    await db.execute(`INSERT INTO payments."PaymentProviderEvents" ("Id","Provider","EventKey","EventType","PayloadHash","ProviderOrderId","ProviderPaymentId","PaymentId","ReceivedAt","ProcessedAt","ProcessingStatus")
      VALUES ($1,'RAZORPAY',$2,$3,$4,$5,$6,$7,$8,$8,$9)`, [newId(), e.key, e.type, e.hash, e.order, e.payment, e.paymentId, e.now, e.status]);
  },
};
