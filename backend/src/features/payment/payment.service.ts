import type { RazorpayConfig } from "../../config/payment.js";
import type { Database, Tx } from "../../infra/database/db.js";
import { type GatewayOrder, type GatewayPayment, type GatewayRefund, GatewayUnavailableError, InvalidProviderEventError, type PaymentGateway } from "../../infra/razorpay/razorpay.gateway.js";
import type { Clock, Page } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { newId, sha256HexLower } from "../../utils/crypto.js";
import { snakeUpper } from "../../utils/enums.js";
import { ForbiddenError, NotFoundError, requireRule } from "../../utils/errors.js";
import { fromMinorUnits, toMinorUnits } from "../../utils/money.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { applyContributionSettlement, type ContributionPaymentSource, readContributionLocked } from "../contribution/contribution.settlement.js";
import type { LedgerPostingService } from "../ledger/ledger.posting.js";
import * as domain from "./payment.domain.js";
import { type Payment, type PaymentStatus } from "./payment.domain.js";
import { mapPayment, paymentRepository } from "./payment.repository.js";

const WEBHOOK_EVENTS = new Set(["payment.authorized", "payment.captured", "payment.failed", "order.paid", "refund.created", "refund.processed", "refund.failed", "payment.refunded"]);
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/** A provider lookup failed or returned an unreadable document: treat as uncertain, never as a result. */
const uncertain = (e: unknown) => e instanceof GatewayUnavailableError || e instanceof InvalidProviderEventError || (e instanceof Error && e.name === "TimeoutError");

/**
 * Port of PaymentService (Razorpay TEST mode). Provider calls happen OUTSIDE database transactions; every state
 * change happens inside one transaction holding the group lock and the payment row lock. Capture settles the
 * contribution and posts Dr 1010 / Cr 2000 exactly once (unique journal per PaymentCaptured+PaymentId).
 */
export class PaymentService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly gateway: PaymentGateway, private readonly ledger: LedgerPostingService,
    private readonly options: RazorpayConfig) {}

  private enabled(): void { requireRule(this.gateway.enabled, "PAYMENTS_DISABLED", "Razorpay Test payments are disabled."); }

  async eligibility(contributionId: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const source = await readContributionLocked(tx, contributionId);
      if (source.userId !== userId) throw new ForbiddenError("This contribution belongs to another member.");
      const p = await paymentRepository.findBy(tx, `"ContributionId" = $1 AND "RefundedAt" IS NULL`, [contributionId]);
      const allowed = this.gateway.enabled && source.canCollect && (p === null || (p.providerOrderId !== null && (p.status === "Pending" || p.status === "Failed")));
      return {
        collectionMode: snakeUpper(source.collectionMode), financiallySettledAmount: source.settledAmount, financialStatus: snakeUpper(source.financialStatus),
        remainingAmount: source.expectedAmount.minus(source.settledAmount), canPay: allowed,
        reason: allowed ? null : !this.gateway.enabled ? "Razorpay Test collection is disabled." : source.settledAmount.gt(0) ? "Contribution settled."
          : p ? "Payment processing; check its status before retrying." : "This cycle is not open for gateway collection.",
        paymentId: p?.id ?? null,
      };
    });
  }

  async create(contributionId: string, userId: string, key: string) {
    this.enabled();
    requireRule(!!key && key.trim().length > 0 && key.length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key of at most 200 characters.");
    const intent = await this.db.transaction(async (tx) => {
      const source = await readContributionLocked(tx, contributionId);
      if (source.userId !== userId) throw new ForbiddenError("This contribution belongs to another member.");
      const replay = await paymentRepository.findBy(tx, `"ContributionId" = $1 AND "IdempotencyKey" = $2`, [contributionId, key.trim()]);
      if (replay) return { done: this.checkout(replay, source.canCollect) };
      requireRule(source.canCollect, "CONTRIBUTION_NOT_PAYABLE", "Only an outstanding contribution in the current active Razorpay collection cycle can be paid.");
      const existing = await paymentRepository.findBy(tx, `"ContributionId" = $1 AND "RefundedAt" IS NULL`, [contributionId]);
      if (existing) return { done: this.checkout(existing, source.canCollect) };
      const attempt = (await tx.one<{ count: number }>(`SELECT count(*)::int AS count FROM payments."Payments" WHERE "ContributionId" = $1`, [contributionId])).count + 1;
      const now = this.clock.now();
      const p = domain.createPayment(newId(), source, source.expectedAmount.minus(source.settledAmount), key, attempt, now);
      await paymentRepository.insert(tx, p);
      await this.history(tx, p, userId, "PAYMENT_ORDER_REQUESTED", "Order intent reserved before provider request.");
      return { payment: p };
    });
    if (intent.done) return intent.done;
    const p = intent.payment!;
    let order: GatewayOrder;
    try {
      order = await this.gateway.createOrder(p.id, p.contributionId, p.groupId, p.cycleId, toMinorUnits(p.amount), p.receipt);
    } catch (e) {
      if (!uncertain(e)) throw e;
      // The intent stays durable even if the client disconnects. Never automatically repeat a POST.
      return this.withPayment(p.id, userId, false, async (tx, current) => {
        domain.reconcile(current, "Failed", "Order result is uncertain. Reconcile the receipt; do not create another order.", this.clock.now());
        await this.history(tx, current, userId, "PAYMENT_ORDER_UNCERTAIN", current.reconciliationMessage!);
        return this.checkout(current, false);
      });
    }
    return this.withPayment(p.id, userId, false, async (tx, current, source) => {
      if (!validOrder(current, order)) { await this.mismatch(tx, current, userId, "Provider order amount, currency, or receipt mismatch."); return this.checkout(current, false); }
      domain.setOrder(current, order.id, this.clock.now());
      await this.history(tx, current, userId, "PAYMENT_ORDER_CREATED", "Razorpay Test order persisted.");
      return this.checkout(current, source.canCollect);
    });
  }

  async verify(id: string, userId: string, input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    this.enabled();
    const p = await this.find(id, userId, false);
    requireRule(input.razorpayOrderId === p.providerOrderId, "PAYMENT_ORDER_MISMATCH", "Order must match the server-created order.");
    requireRule(!!input.razorpayPaymentId?.trim() && input.razorpayPaymentId.length <= 100 &&
      this.gateway.verifyPaymentSignature(p.providerOrderId!, input.razorpayPaymentId, input.razorpaySignature ?? ""), "INVALID_PAYMENT_SIGNATURE", "Payment signature verification failed.");
    const payment = await this.gateway.getPayment(input.razorpayPaymentId);
    const order = await this.gateway.getOrder(p.providerOrderId!);
    return this.withPayment(id, userId, false, async (tx, current, source) => {
      if (payment.id !== input.razorpayPaymentId) await this.mismatch(tx, current, userId, "Provider payment identity mismatch.");
      else {
        if (!(await tx.maybeOne(`SELECT 1 FROM payments."PaymentHistory" WHERE "PaymentId" = $1 AND "Action" = 'PAYMENT_SIGNATURE_VERIFIED'`, [id])))
          await this.history(tx, current, userId, "PAYMENT_SIGNATURE_VERIFIED", "Checkout signature verified server-side.");
        await this.apply(tx, current, source, payment, order, null, userId);
      }
      return view(current);
    });
  }

  async reconcileOne(id: string, actor: string, admin: boolean) {
    this.enabled();
    const p = await this.find(id, actor, admin);
    let order: GatewayOrder | null; let payment: GatewayPayment | undefined;
    try {
      if (p.providerOrderId === null) { const orders = await this.gateway.findOrders(p.receipt); order = orders.length === 1 ? orders[0]! : null; }
      else order = await this.gateway.getOrder(p.providerOrderId);
      if (!order) return this.withPayment(id, actor, admin, async (tx, current) => { await this.mismatch(tx, current, actor, "Order receipt could not be resolved uniquely. No automatic new order."); return view(current); });
      const matches = await this.gateway.getOrderPayments(order.id);
      const successful = matches.filter((x) => x.captured || ["captured", "refunded", "authorized"].includes(x.status));
      if (successful.length > 1)
        return this.withPayment(id, actor, admin, async (tx, current) => { await this.mismatch(tx, current, actor, "More than one successful provider payment needs review."); return view(current); });
      payment = successful[0] ?? [...matches].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    } catch (e) {
      if (!uncertain(e)) throw e;
      return this.withPayment(id, actor, admin, async (tx, current) => {
        domain.reconcile(current, "Failed", "Provider lookup failed. Existing settlement remains unchanged.", this.clock.now());
        await this.history(tx, current, actor, "PAYMENT_RECONCILIATION_FAILED", current.reconciliationMessage!);
        return view(current);
      });
    }
    const resolved = order;
    return this.withPayment(id, actor, admin, async (tx, current, source) => {
      if (!validOrder(current, resolved)) await this.mismatch(tx, current, actor, "Provider order mismatch.");
      else {
        domain.setOrder(current, resolved.id, this.clock.now());
        if (!payment) {
          if (current.capturedAt !== null || resolved.status === "paid") await this.mismatch(tx, current, actor, "Captured payment missing from provider order.");
          else domain.reconcile(current, "Matched", "Order matched; awaiting a captured payment.", this.clock.now());
        } else await this.apply(tx, current, source, payment, resolved, null, actor);
        await this.history(tx, current, actor, current.reconciliationStatus === "Mismatch" ? "PAYMENT_RECONCILIATION_MISMATCH" : "PAYMENT_RECONCILIATION_MATCHED",
          current.reconciliationMessage ?? "Provider state inspected.");
      }
      return view(current);
    });
  }

  /**
   * Razorpay webhook. The HMAC is checked over the exact raw bytes before anything is parsed. Each provider event is
   * processed at most once (EventKey unique + advisory lock); a reused event id with a different payload is rejected.
   */
  async processWebhook(body: Buffer, signature: string, providerEventId: string | undefined): Promise<void> {
    this.enabled();
    requireRule(this.options.webhookEnabled, "WEBHOOKS_DISABLED", "Razorpay webhooks are disabled.");
    requireRule(this.gateway.verifyWebhookSignature(body, signature), "INVALID_WEBHOOK_SIGNATURE", "Webhook signature verification failed.");
    const hash = sha256HexLower(body);
    const key = providerEventId?.trim() ? providerEventId.trim() : `sha256:${hash}`;
    requireRule(key.length <= 200, "INVALID_PROVIDER_EVENT", "Provider event identifier is too long.");
    const prior = await paymentRepository.event(this.db, key);
    if (prior) { validateEvent(prior.PayloadHash, hash); return; }
    const e = this.gateway.parseWebhook(body); // only after exact-byte signature validation
    if (!WEBHOOK_EVENTS.has(e.type)) { await this.storeIgnored(key, e.type, hash); return; }
    const providerId = e.refund?.paymentId ?? e.payment?.id;
    requireRule(!!providerId, "INVALID_PROVIDER_EVENT", "Payment identity is missing.");
    const provider = await this.gateway.getPayment(providerId);
    const order = await this.gateway.getOrder(provider.orderId);
    const match = await this.db.maybeOne<{ Id: string }>(`SELECT "Id" FROM payments."Payments" WHERE "ProviderOrderId" = $1 OR "Receipt" = $2`, [order.id, order.receipt]);
    // Unknown orders may belong to another application on the same test account. Keep only the hash and safe ids.
    if (!match) { await this.storeIgnored(key, e.type, hash); return; }
    await this.withPayment(match.Id, EMPTY_GUID, true, async (tx, p, source) => {
      await tx.advisoryLock(key, 8);
      const existing = await paymentRepository.event(tx, key);
      if (existing) { validateEvent(existing.PayloadHash, hash); return; }
      const snap = e.payment;
      if (provider.id !== providerId || (snap && (snap.orderId !== provider.orderId || snap.amount !== provider.amount || snap.currency !== provider.currency)))
        await this.mismatch(tx, p, p.userId, "Webhook/provider identity or amount mismatch.");
      else await this.apply(tx, p, source, provider, order, e.refund, p.userId);
      await paymentRepository.insertEvent(tx, { key, type: e.type, hash, order: provider.orderId, payment: provider.id, paymentId: p.id,
        status: p.reconciliationStatus === "Mismatch" ? "REVIEW_REQUIRED" : "PROCESSED", now: this.clock.now() });
    });
  }

  private async storeIgnored(key: string, type: string, hash: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.advisoryLock(key, 8);
      const e = await paymentRepository.event(tx, key);
      if (e) validateEvent(e.PayloadHash, hash);
      else await paymentRepository.insertEvent(tx, { key, type, hash, order: null, payment: null, paymentId: null, status: "IGNORED", now: this.clock.now() });
    });
  }

  /** Applies authoritative provider state. Mismatches are sticky; capture settles exactly once; refunds reverse exactly once. */
  private async apply(tx: Tx, p: Payment, source: ContributionPaymentSource, remote: GatewayPayment, order: GatewayOrder, refund: GatewayRefund | null, actor: string): Promise<void> {
    const minor = toMinorUnits(p.amount);
    if (!validOrder(p, order) || remote.orderId !== order.id || remote.amount !== minor || remote.currency !== "INR" || !remote.id.trim() || remote.id.length > 100 ||
      remote.amountRefunded < 0n || remote.amountRefunded > remote.amount || (p.providerPaymentId !== null && p.providerPaymentId !== remote.id && remote.status !== "failed") ||
      (remote.status === "captured" && !remote.captured) || (remote.captured && (!["captured", "refunded"].includes(remote.status) || order.status !== "paid"))) {
      await this.mismatch(tx, p, actor, "Provider identity, amount, currency, or capture state mismatch."); return;
    }
    await tx.advisoryLock(remote.id, 9);
    if (await tx.maybeOne(`SELECT 1 FROM payments."Payments" WHERE "Id" <> $1 AND "ProviderPaymentId" = $2`, [p.id, remote.id])) {
      await this.mismatch(tx, p, actor, "Provider payment already belongs to another internal payment."); return;
    }
    const now = () => this.clock.now();
    domain.setOrder(p, order.id, now());
    // Mismatches are sticky: generic reconciliation cannot silently release an accounting hold.
    if (p.status === "ReconciliationRequired") return;
    if (refund) {
      if (!refund.id.trim() || refund.id.length > 100 || refund.paymentId !== remote.id || refund.amount !== remote.amount || !["pending", "processed", "failed"].includes(refund.status)) {
        await this.mismatch(tx, p, actor, "Only a matching full refund can be applied."); return;
      }
      if (!(await tx.maybeOne(`SELECT 1 FROM payments."PaymentRefunds" WHERE "ProviderRefundId" = $1 AND "Status" = $2`, [refund.id, refund.status])))
        await tx.execute(`INSERT INTO payments."PaymentRefunds" ("Id","PaymentId","ProviderRefundId","Amount","Status","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId(), p.id, refund.id, fromMinorUnits(refund.amount).toFixed(2), refund.status, now()]);
    }
    if (remote.amountRefunded > 0n || refund?.status === "processed" || remote.status === "refunded") {
      if (remote.amountRefunded !== remote.amount || source.selectionCompleted || p.settledAt === null) {
        await this.mismatch(tx, p, actor, "Refund requires a recorded full capture and an unselected cycle. Exceptional review required."); return;
      }
      if (p.refundedAt === null) {
        const result = await this.ledger.reverse(tx, p.journalId!, newId(), "Confirmed full Razorpay Test refund", actor);
        await applyContributionSettlement(tx, p.contributionId, p.id, null, now());
        domain.refundPayment(p, result.journalId!, now());
        await this.history(tx, p, actor, "PAYMENT_REFUNDED", "Full refund confirmed; contribution settlement reversed.");
      }
    } else if (remote.status === "captured" && remote.captured) {
      if (p.capturedAt === null) {
        if (!source.settledAmount.isZero() || source.selectionCompleted || source.collectionMode !== "Razorpay") {
          await this.mismatch(tx, p, actor, "Capture cannot be applied to this contribution; over-settlement prevented."); return;
        }
        domain.observe(p, remote.id, "Captured", now(), now());
        await this.flush(tx, p); // visible to the ledger source reader in this same transaction
        await applyContributionSettlement(tx, p.contributionId, p.id, p.amount, now());
        domain.settlePayment(p, await this.ledger.capturePayment(tx, p.id), now());
        await this.history(tx, p, actor, "PAYMENT_CAPTURED", "Verified test capture financially settled the contribution.");
      }
      if (refund?.status === "failed" && p.status === "RefundPending") {
        domain.refundFailed(p, now());
        await this.history(tx, p, actor, "PAYMENT_REFUND_FAILED", "Provider refund failed; captured settlement remains in place.");
      }
      if (refund?.status === "pending" && p.status !== "RefundPending" &&
        !(await tx.maybeOne(`SELECT 1 FROM payments."PaymentRefunds" WHERE "ProviderRefundId" = $1 AND "Status" IN ('failed','processed')`, [refund.id]))) {
        domain.refundPending(p, now());
        await this.history(tx, p, actor, "PAYMENT_REFUND_REQUESTED", "Provider reports a full refund pending; no reversal until confirmation.");
      }
    } else if (remote.status === "authorized" || remote.status === "failed") {
      if (domain.observe(p, remote.id, remote.status === "authorized" ? "Authorized" : "Failed", remote.createdAt, now()))
        await this.history(tx, p, actor, remote.status === "authorized" ? "PAYMENT_AUTHORIZED" : "PAYMENT_FAILED", "Provider status observed; no financial settlement.");
    } else { await this.mismatch(tx, p, actor, "Unsupported provider payment state."); return; }
    domain.reconcile(p, "Matched", "Order, payment identity, amount, currency and provider state matched. Bank settlement is not implied.", now());
  }

  private async mismatch(tx: Tx, p: Payment, actor: string, reason: string): Promise<void> {
    domain.reconcile(p, "Mismatch", reason, this.clock.now());
    await this.history(tx, p, actor, "PAYMENT_RECONCILIATION_MISMATCH", reason);
  }

  private async history(tx: Tx, p: Payment, actor: string, action: string, message: string): Promise<void> {
    const now = this.clock.now();
    await paymentRepository.insertHistory(tx, p.id, actor, action, message, now);
    await writeAuditLog(tx, { actorUserId: actor === EMPTY_GUID ? null : actor, action, entityType: "Payment", entityId: p.id, timestamp: now });
  }

  private snapshots = new WeakMap<Payment, ReturnType<typeof paymentRepository.snapshot>>();
  private async flush(tx: Tx, p: Payment): Promise<void> {
    this.snapshots.set(p, await paymentRepository.save(tx, p, this.snapshots.get(p)!));
  }

  private async find(id: string, actor: string, admin: boolean): Promise<Payment> {
    const p = await paymentRepository.find(this.db, id);
    if (!p) throw new NotFoundError("Payment not found.");
    if (!admin && p.userId !== actor) throw new ForbiddenError("This payment belongs to another member.");
    return p;
  }

  /** WithPayment: ownership check, then one transaction holding the group lock (via the contribution) and the payment row lock. */
  private async withPayment<T>(id: string, actor: string, admin: boolean, action: (tx: Tx, p: Payment, source: ContributionPaymentSource) => Promise<T>): Promise<T> {
    const initial = await this.find(id, actor, admin);
    return this.db.transaction(async (tx) => {
      const source = await readContributionLocked(tx, initial.contributionId);
      const p = (await paymentRepository.find(tx, id, true))!;
      this.snapshots.set(p, paymentRepository.snapshot(p));
      const result = await action(tx, p, source);
      await this.flush(tx, p);
      return result;
    });
  }

  private checkout(p: Payment, eligible: boolean) {
    return { payment: view(p), keyId: this.gateway.publicKey, amountInMinorUnits: Number(toMinorUnits(p.amount)),
      checkoutAllowed: eligible && this.gateway.enabled && p.providerOrderId !== null && (p.status === "Pending" || p.status === "Failed") };
  }

  async details(id: string, actor: string, admin: boolean) {
    const p = await this.find(id, actor, admin);
    const timeline = await this.db.query<Record<string, unknown>>(`SELECT * FROM payments."PaymentHistory" WHERE "PaymentId" = $1 ORDER BY "CreatedAt", "Id"`, [id]);
    const events = admin ? await this.db.query<Record<string, unknown>>(`SELECT * FROM payments."PaymentProviderEvents" WHERE "PaymentId" = $1 ORDER BY "ReceivedAt", "Id"`, [id]) : [];
    const refunds = await this.db.query<Record<string, unknown>>(`SELECT * FROM payments."PaymentRefunds" WHERE "PaymentId" = $1 ORDER BY "CreatedAt", "Id"`, [id]);
    return {
      payment: view(p),
      timeline: timeline.map((h) => ({ id: h.Id, paymentId: h.PaymentId, actorId: h.ActorId, action: h.Action, message: h.Message, createdAt: h.CreatedAt })),
      events: events.map((e) => ({ id: e.Id, provider: e.Provider, eventKey: e.EventKey, eventType: e.EventType, payloadHash: e.PayloadHash, providerOrderId: e.ProviderOrderId,
        providerPaymentId: e.ProviderPaymentId, paymentId: e.PaymentId, receivedAt: e.ReceivedAt, processedAt: e.ProcessedAt, processingStatus: e.ProcessingStatus })),
      refunds: refunds.map((r) => ({ id: r.Id, paymentId: r.PaymentId, providerRefundId: r.ProviderRefundId, amount: r.Amount, status: r.Status, createdAt: r.CreatedAt })),
    };
  }

  async list(actor: string, admin: boolean, page: number, pageSize: number, status: PaymentStatus | undefined): Promise<Page<unknown> & Record<string, unknown>> {
    page = clamp(page, 1, 100000); pageSize = clamp(pageSize, 1, 100);
    const scope = admin ? "TRUE" : `"UserId" = $1`; const base = admin ? [] : [actor];
    const totals = new Map((await this.db.query<{ Status: PaymentStatus; count: number }>(`SELECT "Status", count(*)::int AS count FROM payments."Payments" WHERE ${scope} GROUP BY "Status"`, base)).map((r) => [r.Status, r.count]));
    const params = [...base]; let where = scope;
    if (status) { params.push(status); where += ` AND "Status" = $${params.length}`; }
    const count = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM payments."Payments" WHERE ${where}`, params)).count;
    const items = (await this.db.query(`SELECT * FROM payments."Payments" WHERE ${where} ORDER BY "CreatedAt" DESC, "Id" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params)).map(mapPayment);
    const c = (s: PaymentStatus) => totals.get(s) ?? 0;
    return { items: items.map(view), totalCount: count, page, pageSize, captured: c("Captured"), pending: c("Created") + c("Pending") + c("Authorized"),
      failed: c("Failed"), reconciliationRequired: c("ReconciliationRequired") };
  }
}

const validateEvent = (stored: string, hash: string) => requireRule(stored === hash, "PROVIDER_EVENT_REUSED", "Event identity was reused with a different payload.");

function validOrder(p: Payment, o: GatewayOrder): boolean {
  return !!o.id.trim() && o.id.length <= 100 && (p.providerOrderId === null || p.providerOrderId === o.id) && o.amount === toMinorUnits(p.amount) && o.currency === p.currency &&
    o.receipt === p.receipt && ["created", "attempted", "paid"].includes(o.status);
}

export function view(p: Payment) {
  return {
    id: p.id, contributionId: p.contributionId, groupId: p.groupId, groupName: p.groupName, cycleId: p.cycleId, cycleNumber: p.cycleNumber, membershipId: p.membershipId, userId: p.userId,
    memberName: p.memberName, amount: p.amount, currency: p.currency, provider: p.provider, environment: p.environment, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId,
    status: snakeUpper(p.status), attemptNumber: p.attemptNumber, reconciliationStatus: snakeUpper(p.reconciliationStatus), reconciliationMessage: p.reconciliationMessage,
    lastReconciledAt: p.lastReconciledAt, createdAt: p.createdAt, capturedAt: p.capturedAt, settledAt: p.settledAt, refundedAt: p.refundedAt, journalId: p.journalId,
    reversalJournalId: p.reversalJournalId, failureReason: p.failureReason,
  };
}
