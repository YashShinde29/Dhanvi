import { snapshot, type Snapshot, updateChanged } from "../../infra/database/changes.js";
import type { Database, Queryable, Row, Tx } from "../../infra/database/db.js";
import type { GatewayPayout, PayoutGateway } from "../../services/payout-gateway.service.js";
import type { Clock } from "../../types/common.types.js";
import { newId } from "../../utils/crypto.js";
import { netDecimal, netFingerprint, netInt } from "../../utils/dotnet-json.js";
import { enumIndex, snakeUpper } from "../../utils/enums.js";
import { BusinessRuleError, ForbiddenError, NotFoundError, requireRule } from "../../utils/errors.js";
import type { Decimal } from "../../utils/money.js";
import { sum } from "../../utils/money.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { canInspectGroup, completeCycleAndOpenNext, readSettlementCycle, type SettlementCycle } from "../cycle/cycle.settlement.js";
import type { AccountingEventType } from "../ledger/ledger.domain.js";
import type { LedgerPostingService } from "../ledger/ledger.posting.js";
import { readLedgerSource } from "../ledger/ledger.sources.js";
import * as domain from "./payout.domain.js";
import { type Beneficiary, GATEWAY_PAYOUT_STATUSES, type PayoutAttempt, type PayoutObligation, type PayoutStatus, type PayoutType } from "./payout.domain.js";

const mapObligation = (r: Row): PayoutObligation => ({
  id: r.Id as string, groupId: r.GroupId as string, groupName: r.GroupName as string, cycleId: r.CycleId as string, cycleNumber: r.CycleNumber as number,
  membershipId: r.MembershipId as string | null, userId: r.UserId as string | null, memberName: r.MemberName as string, selectionResultId: r.SelectionResultId as string,
  auctionResultId: r.AuctionResultId as string | null, sourceId: r.SourceId as string, payoutType: r.PayoutType as PayoutType, amount: r.Amount as Decimal, currency: r.Currency as string,
  timeZone: r.TimeZone as string, status: r.Status as PayoutStatus, beneficiaryId: r.BeneficiaryId as string | null, approvedByUserId: r.ApprovedByUserId as string | null,
  approvedAt: r.ApprovedAt as Date | null, allocationJournalId: r.AllocationJournalId as string, settlementJournalId: r.SettlementJournalId as string | null,
  createdAt: r.CreatedAt as Date, updatedAt: r.UpdatedAt as Date, settledAt: r.SettledAt as Date | null, version: r.Version as number,
});
const obligationColumns = (p: PayoutObligation) => ({ Status: p.status, BeneficiaryId: p.beneficiaryId, ApprovedByUserId: p.approvedByUserId, ApprovedAt: p.approvedAt,
  SettlementJournalId: p.settlementJournalId, SettledAt: p.settledAt, UpdatedAt: p.updatedAt, Version: p.version });
const mapBeneficiary = (r: Row): Beneficiary => ({ id: r.Id as string, userId: r.UserId as string, provider: "FAKE", providerFundAccountId: r.ProviderFundAccountId as string,
  accountType: "BANK_ACCOUNT", maskedAccountNumber: r.MaskedAccountNumber as string, accountHolderName: r.AccountHolderName as string, bankName: r.BankName as string, ifsc: r.Ifsc as string,
  status: r.Status as Beneficiary["status"], createdAt: r.CreatedAt as Date, availableAt: r.AvailableAt as Date });
const mapAttempt = (r: Row): PayoutAttempt => ({ id: r.Id as string, payoutObligationId: r.PayoutObligationId as string, attemptNumber: r.AttemptNumber as number, provider: "FAKE",
  providerPayoutId: r.ProviderPayoutId as string, idempotencyKey: r.IdempotencyKey as string, requestKey: r.RequestKey as string, beneficiaryId: r.BeneficiaryId as string,
  providerFundAccountId: r.ProviderFundAccountId as string, maskedAccountNumber: r.MaskedAccountNumber as string, amount: r.Amount as Decimal, currency: r.Currency as string,
  requestedAt: r.RequestedAt as Date, createdByUserId: r.CreatedByUserId as string });

/** AdminPayoutApprovalPolicy: admins only, never the recipient. */
function ensureOperator(admin: boolean, actor: string, recipient: string | null): void {
  if (!admin) throw new ForbiddenError("Admin or SuperAdmin payout authorization is required.");
  requireRule(actor !== recipient, "PAYOUT_SELF_APPROVAL_NOT_ALLOWED", "Recipients cannot approve or execute their own payouts.");
}
const active = (c: SettlementCycle) => requireRule(c.active, "PAYOUT_GROUP_SUSPENDED", "Payout execution requires an active group.");
const eventFor = (c: SettlementCycle): AccountingEventType => {
  if (c.selectionMethod === "Random") return "RandomSelectionCompleted";
  if (c.selectionMethod === "OrganizerReserved") return "OrganizerReservedSelectionCompleted";
  if (c.selectionMethod === "Auction") return "AuctionSelectionCompleted";
  throw new BusinessRuleError("INVALID_PAYOUT_SOURCE", "Unsupported selection method.");
};

/**
 * Port of PayoutService: WINNER_PAYOUT, MEMBER_AUCTION_BENEFIT and PLATFORM_FEE_SETTLEMENT obligations created from the
 * funded selection journal; admin approval locks the beneficiary version; execution reserves a durable attempt before
 * the provider call; reconciliation settles the liability exactly once (Dr 2100/2200, Cr 1020).
 */
export class PayoutService {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly ledger: LedgerPostingService, private readonly gateway: PayoutGateway) {}

  private latestBeneficiary(db: Queryable, user: string): Promise<Row | null> {
    return db.maybeOne(`SELECT * FROM payouts."PayoutBeneficiaries" WHERE "UserId" = $1 ORDER BY "CreatedAt" DESC, "Id" DESC LIMIT 1`, [user]);
  }

  async account(user: string) {
    const b = await this.latestBeneficiary(this.db, user);
    return b ? beneficiaryView(mapBeneficiary(b)) : null;
  }

  async addAccount(user: string, r: { accountHolderName: string; accountNumber: string; confirmAccountNumber: string; ifsc: string; bankName?: string | null }) {
    domain.validateBeneficiaryInput(r.accountHolderName, r.accountNumber, r.confirmAccountNumber, r.ifsc, r.bankName);
    return this.db.transaction(async (tx) => {
      await tx.advisoryLock(user, 92);
      const previousRow = await this.latestBeneficiary(tx, user);
      const previous = previousRow && mapBeneficiary(previousRow);
      let now = this.clock.now();
      if (previous && now.getTime() <= previous.createdAt.getTime()) now = new Date(previous.createdAt.getTime() + 1);
      const token = await this.gateway.createFundAccount(newId());
      const b = domain.createBeneficiary(newId(), user, token, r.accountHolderName, r.accountNumber.slice(-4), r.ifsc, r.bankName ?? "", now, previous !== null);
      await tx.execute(`INSERT INTO payouts."PayoutBeneficiaries" ("Id","UserId","Provider","ProviderFundAccountId","AccountType","MaskedAccountNumber","AccountHolderName","BankName","Ifsc","Status","CreatedAt","AvailableAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [b.id, b.userId, b.provider, b.providerFundAccountId, b.accountType, b.maskedAccountNumber, b.accountHolderName, b.bankName, b.ifsc, b.status, b.createdAt, b.availableAt]);
      await writeAuditLog(tx, { actorUserId: user, action: previous ? "PAYOUT_BENEFICIARY_CHANGED" : "PAYOUT_BENEFICIARY_ADDED", entityType: "Payout", entityId: b.id, timestamp: this.clock.now() });
      return beneficiaryView(b);
    });
  }

  async prepareCycleSettlement(cycleId: string, actor: string, admin: boolean) {
    ensureOperator(admin, actor, null);
    const rows = await this.db.transaction(async (tx) => {
      const c = await readSettlementCycle(tx, cycleId);
      const existing = (await tx.query(`SELECT * FROM payouts."PayoutObligations" WHERE "CycleId" = $1 ORDER BY "CreatedAt", "Id"`, [cycleId])).map(mapObligation);
      if (existing.length > 0) return existing;
      active(c);
      requireRule(c.status === "SelectionCompleted" && c.selectionResultId !== null, "INVALID_PAYOUT_SOURCE", "A finalized selection is required.");
      const s = await readLedgerSource(tx, eventFor(c), c.selectionResultId);
      const posted = await this.ledger.post(tx, eventFor(c), c.selectionResultId, actor);
      requireRule(posted.status === "POSTED" && posted.journalId !== null, "INSUFFICIENT_FUNDED_POOL", "Ledger must contain the full funded pool before preparing payouts.");
      const now = this.clock.now();
      const create = (type: PayoutType, member: string | null, amount: Decimal) => {
        const recipient = member ? c.recipients.find((r) => r.membershipId === member) : undefined;
        requireRule(!member || recipient !== undefined, "INVALID_PAYOUT_SOURCE", "Source recipient must belong to the cycle.");
        return domain.createObligation({ id: newId(), groupId: c.groupId, groupName: c.groupName, cycleId, cycleNumber: c.cycleNumber, membershipId: member, userId: recipient?.userId ?? null,
          memberName: recipient?.name ?? "Platform fee (internal)", selectionResultId: s.selectionResultId!, auctionResultId: s.auctionResultId, sourceId: member ?? s.selectionResultId!,
          payoutType: type, amount, timeZone: s.timeZone, allocationJournalId: posted.journalId!, createdAt: now });
      };
      const created = [create("WinnerPayout", s.winnerMembershipId, s.winnerPayout), ...s.benefits.map((b) => create("MemberAuctionBenefit", b.membershipId, b.amount))];
      if (s.platformFee.gt(0)) { const fee = create("PlatformFeeSettlement", null, s.platformFee); domain.settleInternalFee(fee, now); created.push(fee); }
      for (const p of created)
        await tx.execute(`INSERT INTO payouts."PayoutObligations" ("Id","GroupId","GroupName","CycleId","CycleNumber","MembershipId","UserId","MemberName","SelectionResultId","AuctionResultId","SourceId",
          "PayoutType","Amount","Currency","TimeZone","Status","BeneficiaryId","ApprovedByUserId","ApprovedAt","AllocationJournalId","SettlementJournalId","CreatedAt","UpdatedAt","SettledAt","Version")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [p.id, p.groupId, p.groupName, p.cycleId, p.cycleNumber, p.membershipId, p.userId, p.memberName, p.selectionResultId, p.auctionResultId, p.sourceId, p.payoutType, p.amount.toFixed(2),
            p.currency, p.timeZone, p.status, p.beneficiaryId, p.approvedByUserId, p.approvedAt, p.allocationJournalId, p.settlementJournalId, p.createdAt, p.updatedAt, p.settledAt, p.version]);
      for (const p of created.filter((x) => x.payoutType !== "PlatformFeeSettlement")) await this.ledger.ensurePayoutFunded(tx, p.id);
      for (const p of created) {
        await this.history(tx, p, actor, "PAYOUT_OBLIGATIONS_CREATED", "Immutable selection allocations backed by the funded Ledger journal.");
        if (p.payoutType === "PlatformFeeSettlement")
          await this.history(tx, p, actor, "PLATFORM_FEE_SETTLED", "Internal allocation completed under the source journal fee policy; no external transfer or additional revenue recognition.");
      }
      return created;
    });
    return this.views(rows);
  }

  approve(id: string, actor: string, admin: boolean) {
    return this.withPayout(id, async (tx, p, c) => {
      ensureOperator(admin, actor, p.userId); active(c);
      if (p.status === "Approved") return this.view(tx, p);
      requireRule(p.userId !== null, "PAYOUT_NOT_READY", "Internal fees do not require a beneficiary.");
      await tx.advisoryLock(p.userId, 92);
      const b = await this.latestBeneficiary(tx, p.userId);
      if (!b) throw new BusinessRuleError("PAYOUT_BENEFICIARY_REQUIRED", "The recipient must add a payout account.");
      domain.approve(p, mapBeneficiary(b), actor, this.clock.now());
      await this.history(tx, p, actor, "PAYOUT_APPROVED", "Admin approval locked the beneficiary version.");
      return this.view(tx, p);
    });
  }

  async execute(id: string, actor: string, admin: boolean, key: string, retry: boolean) {
    requireRule(!!key && key.trim().length > 0 && key.length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send a stable Idempotency-Key of at most 200 characters.");
    let intent: PayoutAttempt | null = null;
    const reserved = await this.withPayout(id, async (tx, p, c) => {
      ensureOperator(admin, actor, p.userId); active(c);
      if ((await tx.maybeOne(`SELECT 1 FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 AND "RequestKey" = $2`, [id, key])) ||
        ["Succeeded", "Processing", "ProviderPending"].includes(p.status)) return this.view(tx, p);
      await this.ledger.ensurePayoutFunded(tx, p.id);
      domain.begin(p, retry, this.clock.now());
      await this.flush(tx, p);
      const b = mapBeneficiary((await tx.one(`SELECT * FROM payouts."PayoutBeneficiaries" WHERE "Id" = $1`, [p.beneficiaryId]))!);
      const number = (await tx.one<{ count: number }>(`SELECT count(*)::int AS count FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1`, [id])).count + 1;
      intent = domain.createAttempt(newId(), p, b, number, key, actor, this.clock.now());
      await insertAttempt(tx, intent);
      await this.history(tx, p, actor, retry ? "PAYOUT_RETRY_CREATED" : "PAYOUT_EXECUTION_REQUESTED", "Durable immutable intent reserved before provider call.");
      return this.view(tx, p);
    });
    if (!intent) return reserved;
    try { await this.gateway.initiatePayout(request(intent)); } catch { return reserved; } // durable Processing intent; reconcile the SAME key later
    return this.reconcile(id, actor, admin);
  }

  async reconcile(id: string, actor: string, admin: boolean) {
    ensureOperator(admin, actor, null);
    const initialRow = await this.db.maybeOne(`SELECT * FROM payouts."PayoutObligations" WHERE "Id" = $1`, [id]);
    if (!initialRow) throw new NotFoundError("Payout not found.");
    const initial = mapObligation(initialRow);
    const attemptRow = await this.db.maybeOne(`SELECT * FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 ORDER BY "AttemptNumber" DESC LIMIT 1`, [id]);
    if (!attemptRow || initial.status === "Succeeded" || initial.status === "ReconciliationRequired") return this.view(this.db, initial);
    const attempt = mapAttempt(attemptRow);
    let remote = await this.gateway.getPayoutStatus(attempt.providerPayoutId);
    if (!remote) {
      // Re-submit only the durable SAME intent/key, after rechecking group and liability under lock.
      await this.withPayout(id, async (tx, p, c) => {
        if (p.status === "Succeeded" || p.status === "ReconciliationRequired") return false;
        const current = await tx.one<{ Id: string }>(`SELECT "Id" FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 ORDER BY "AttemptNumber" DESC LIMIT 1`, [id]);
        if (current.Id !== attempt.id) return false;
        active(c); ensureOperator(admin, actor, p.userId);
        requireRule(p.status === "Processing", "PAYOUT_RECONCILIATION_REQUIRED", "Missing provider transfer requires review.");
        await this.ledger.ensurePayoutFunded(tx, id); await this.gateway.initiatePayout(request(attempt));
        return true;
      });
      remote = await this.gateway.getPayoutStatus(attempt.providerPayoutId);
    }
    return this.withPayout(id, async (tx, p, c) => {
      if (p.status === "Succeeded" || p.status === "ReconciliationRequired") return this.view(tx, p);
      const latest = await tx.one<{ Id: string }>(`SELECT "Id" FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 ORDER BY "AttemptNumber" DESC LIMIT 1`, [id]);
      if (latest.Id !== attempt.id) return this.view(tx, p); // an earlier attempt's observation cannot alter its retry
      let matched = remote !== null && remote.id === attempt.providerPayoutId && remote.amount.eq(p.amount) && remote.currency === p.currency &&
        remote.fundAccountId === attempt.providerFundAccountId && remote.reference === p.id.replace(/-/g, "") && (GATEWAY_PAYOUT_STATUSES as readonly string[]).includes(remote.status);
      if (p.status === "Failed" && remote?.status !== "Failed") matched = false;
      const hash = payloadHash(remote);
      const eventId = remote?.eventId ?? `missing:${attempt.id}`;
      await tx.advisoryLock(eventId, 93);
      const prior = await tx.maybeOne<{ PayloadHash: string; PayoutAttemptId: string }>(`SELECT "PayloadHash","PayoutAttemptId" FROM payouts."PayoutProviderEvents" WHERE "ProviderEventId" = $1`, [eventId]);
      if (prior) {
        requireRule(prior.PayloadHash === hash && prior.PayoutAttemptId === attempt.id, "PROVIDER_EVENT_REUSED", "Provider event identity was reused with different content.");
        return this.view(tx, p);
      }
      await tx.execute(`INSERT INTO payouts."PayoutProviderEvents" ("Id","PayoutObligationId","PayoutAttemptId","Provider","ProviderPayoutId","ProviderEventId","PayloadHash","Status","Matched","ReceivedAt")
        VALUES ($1,$2,$3,'FAKE',$4,$5,$6,$7,$8,$9)`, [newId(), p.id, attempt.id, attempt.providerPayoutId, eventId, hash, remote?.status ?? "Pending", matched, this.clock.now()]);
      if (!matched) {
        domain.observePayout(p, "ReconciliationRequired", this.clock.now());
        await this.history(tx, p, actor, "PAYOUT_RECONCILIATION_MISMATCH", "Provider identity, amount, currency, destination, reference or terminal status did not match. Hold requires review.");
      } else {
        await this.history(tx, p, actor, "PAYOUT_RECONCILIATION_MATCHED", "Authoritative provider state matched the immutable instruction.");
        if (remote!.status === "Success") {
          domain.settlePayout(p, await this.ledger.settlePayout(tx, id), this.clock.now());
          await this.history(tx, p, actor, "PAYOUT_SUCCEEDED", "Matched fake provider success settled the liability once.");
          if (p.payoutType === "MemberAuctionBenefit") await this.history(tx, p, actor, "AUCTION_BENEFIT_SETTLED", "Member benefit independently settled.");
        } else {
          const failed = remote!.status === "Failed";
          domain.observePayout(p, failed ? "Failed" : "ProviderPending", this.clock.now());
          await this.history(tx, p, actor, failed ? "PAYOUT_FAILED" : "PAYOUT_PROVIDER_PENDING", "Liability remains outstanding; no settlement journal posted.");
        }
      }
      await this.flush(tx, p);
      if (c.active) await this.evaluate(tx, c.cycleId, actor);
      return this.view(tx, p);
    });
  }

  async evaluateCycleSettlement(cycleId: string, actor: string, admin: boolean): Promise<boolean> {
    ensureOperator(admin, actor, null);
    return this.db.transaction(async (tx) => {
      const c = await readSettlementCycle(tx, cycleId);
      if (c.status === "Completed") return true;
      active(c);
      return this.evaluate(tx, cycleId, actor);
    });
  }

  /** Completes the cycle once every immutable allocation has settled, then opens the next cycle (or completes the group). */
  private async evaluate(tx: Tx, cycleId: string, actor: string): Promise<boolean> {
    const rows = (await tx.query(`SELECT * FROM payouts."PayoutObligations" WHERE "CycleId" = $1`, [cycleId])).map(mapObligation);
    if (rows.length === 0 || rows.some((p) => p.status !== "Succeeded")) return false;
    const c = await readSettlementCycle(tx, cycleId);
    const s = await readLedgerSource(tx, eventFor(c), c.selectionResultId!);
    requireRule(rows.filter((p) => p.payoutType === "WinnerPayout" && p.membershipId === s.winnerMembershipId && p.amount.eq(s.winnerPayout)).length === 1 &&
      rows.length === 1 + s.benefits.length + (s.platformFee.gt(0) ? 1 : 0) && sum(rows.map((p) => p.amount)).eq(s.groupValue) &&
      s.benefits.every((b) => rows.filter((p) => p.payoutType === "MemberAuctionBenefit" && p.membershipId === b.membershipId && p.amount.eq(b.amount)).length === 1) &&
      (s.platformFee.isZero() || rows.filter((p) => p.payoutType === "PlatformFeeSettlement" && p.amount.eq(s.platformFee)).length === 1),
      "CYCLE_SETTLEMENT_INCOMPLETE", "Every immutable source allocation must be fully settled.");
    await completeCycleAndOpenNext(tx, cycleId, actor, this.clock.now());
    return true;
  }

  private snapshots = new WeakMap<PayoutObligation, Snapshot>();
  private async flush(tx: Tx, p: PayoutObligation): Promise<void> {
    await updateChanged(tx, `payouts."PayoutObligations"`, p.id, this.snapshots.get(p)!, obligationColumns(p));
    this.snapshots.set(p, snapshot(obligationColumns(p)));
  }

  private async withPayout<T>(id: string, action: (tx: Tx, p: PayoutObligation, c: SettlementCycle) => Promise<T>): Promise<T> {
    const head = await this.db.maybeOne<{ CycleId: string }>(`SELECT "CycleId" FROM payouts."PayoutObligations" WHERE "Id" = $1`, [id]);
    if (!head) throw new NotFoundError("Payout not found.");
    return this.db.transaction(async (tx) => {
      const c = await readSettlementCycle(tx, head.CycleId);
      const p = mapObligation((await tx.one(`SELECT * FROM payouts."PayoutObligations" WHERE "Id" = $1 FOR UPDATE`, [id]))!);
      this.snapshots.set(p, snapshot(obligationColumns(p)));
      const result = await action(tx, p, c);
      await this.flush(tx, p);
      return result;
    });
  }

  private async history(tx: Tx, p: PayoutObligation, actor: string, action: string, message: string): Promise<void> {
    const now = this.clock.now();
    await tx.execute(`INSERT INTO payouts."PayoutReconciliationHistory" ("Id","PayoutObligationId","ActorUserId","Action","Message","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6)`, [newId(), p.id, actor, action, message, now]);
    await writeAuditLog(tx, { actorUserId: actor, action, entityType: "Payout", entityId: p.id, timestamp: now });
  }

  // ---- queries -------------------------------------------------------------------------------------------------

  private async beneficiaryAvailable(db: Queryable, user: string): Promise<boolean> {
    const b = await this.latestBeneficiary(db, user);
    return b !== null && (b.AvailableAt as Date).getTime() <= this.clock.now().getTime();
  }

  private async view(db: Queryable, p: PayoutObligation) {
    const masked = p.beneficiaryId ? (await db.one<{ MaskedAccountNumber: string }>(`SELECT "MaskedAccountNumber" FROM payouts."PayoutBeneficiaries" WHERE "Id" = $1`, [p.beneficiaryId])).MaskedAccountNumber : null;
    const available = p.beneficiaryId !== null || p.userId === null || (await this.beneficiaryAvailable(db, p.userId));
    return {
      id: p.id, groupId: p.groupId, groupName: p.groupName, cycleId: p.cycleId, cycleNumber: p.cycleNumber, memberName: p.memberName, payoutType: snakeUpper(p.payoutType), amount: p.amount,
      currency: p.currency, status: snakeUpper(p.status), maskedAccountNumber: masked, selectionResultId: p.selectionResultId, auctionResultId: p.auctionResultId,
      allocationJournalId: p.allocationJournalId, settlementJournalId: p.settlementJournalId, createdAt: p.createdAt, approvedAt: p.approvedAt, settledAt: p.settledAt, beneficiaryAvailable: available,
    };
  }

  private async views(rows: PayoutObligation[]) {
    const out = [];
    for (const p of rows) out.push(await this.view(this.db, p));
    return out;
  }

  async list(actor: string, admin: boolean, group: string | undefined, page: number, status: PayoutStatus | undefined, type: PayoutType | undefined,
    filter: { cycleId?: string; from?: Date; to?: Date } = {}) {
    page = Math.max(1, page);
    const params: unknown[] = []; const where: string[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (group) {
      if (!admin && !(await canInspectGroup(this.db, group, actor))) throw new ForbiddenError("Only the group's organizer may inspect group payouts.");
      where.push(`"GroupId" = ${p(group)}`);
    } else if (!admin) where.push(`"UserId" = ${p(actor)}`);
    if (filter.cycleId) where.push(`"CycleId" = ${p(filter.cycleId)}`);
    if (filter.from) where.push(`"CreatedAt" >= ${p(filter.from)}`);
    if (filter.to) where.push(`"CreatedAt" < ${p(filter.to)}`);
    const base = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const summary = await this.db.query<{ Status: PayoutStatus; count: number }>(`SELECT "Status", count(*)::int AS count FROM payouts."PayoutObligations" ${base} GROUP BY "Status"`, params);
    if (status) where.push(`"Status" = ${p(status)}`);
    if (type) where.push(`"PayoutType" = ${p(type)}`);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM payouts."PayoutObligations" ${clause}`, params)).count;
    const rows = (await this.db.query(`SELECT * FROM payouts."PayoutObligations" ${clause} ORDER BY "CreatedAt" DESC, "Id" LIMIT 20 OFFSET ${(page - 1) * 20}`, params)).map(mapObligation);
    return { items: await this.views(rows), totalCount: count, page, pageSize: 20, summary: Object.fromEntries(summary.map((s) => [snakeUpper(s.Status), s.count])) };
  }

  async details(id: string, actor: string, admin: boolean) {
    const row = await this.db.maybeOne(`SELECT * FROM payouts."PayoutObligations" WHERE "Id" = $1`, [id]);
    if (!row) throw new NotFoundError("Payout not found.");
    const p = mapObligation(row);
    if (!admin && p.userId !== actor) throw new ForbiddenError("This payout belongs to another member.");
    const attempts = (await this.db.query(`SELECT * FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 ORDER BY "AttemptNumber"`, [id])).map(mapAttempt);
    const events = await this.db.query<{ Id: string; PayoutAttemptId: string; ProviderEventId: string; Status: string; Matched: boolean; ReceivedAt: Date }>(
      `SELECT "Id","PayoutAttemptId","ProviderEventId","Status","Matched","ReceivedAt" FROM payouts."PayoutProviderEvents" WHERE "PayoutObligationId" = $1 ORDER BY "ReceivedAt", "Id"`, [id]);
    const history = await this.db.query<{ Id: string; Action: string; Message: string; CreatedAt: Date }>(
      `SELECT "Id","Action","Message","CreatedAt" FROM payouts."PayoutReconciliationHistory" WHERE "PayoutObligationId" = $1 ORDER BY "CreatedAt", "Id"`, [id]);
    return {
      payout: await this.view(this.db, p),
      attempts: attempts.map((a) => {
        const obs = events.filter((e) => e.PayoutAttemptId === a.id);
        const failed = obs.some((e) => e.Matched && e.Status === "Failed"); const success = obs.some((e) => e.Matched && e.Status === "Success"); const mismatch = obs.some((e) => !e.Matched);
        return { id: a.id, attemptNumber: a.attemptNumber, provider: a.provider, providerPayoutId: a.providerPayoutId, amount: a.amount, maskedAccountNumber: a.maskedAccountNumber,
          requestedAt: a.requestedAt, status: mismatch ? "RECONCILIATION_REQUIRED" : success ? "SUCCEEDED" : failed ? "FAILED" : obs.length > 0 ? "PROVIDER_PENDING" : "PROCESSING",
          completedAt: obs.find((e) => e.Matched && (e.Status === "Success" || e.Status === "Failed"))?.ReceivedAt ?? null, failureCode: failed ? "PAYOUT_PROVIDER_FAILED" : null };
      }),
      timeline: history.map((h) => ({ id: h.Id, action: h.Action, message: h.Message, createdAt: h.CreatedAt })),
      events: admin ? events.map((e) => ({ id: e.Id, providerEventId: e.ProviderEventId, status: snakeUpper(e.Status), matched: e.Matched, receivedAt: e.ReceivedAt })) : [],
    };
  }
}

async function insertAttempt(tx: Tx, a: PayoutAttempt): Promise<void> {
  await tx.execute(`INSERT INTO payouts."PayoutAttempts" ("Id","PayoutObligationId","AttemptNumber","Provider","ProviderPayoutId","IdempotencyKey","RequestKey","BeneficiaryId","ProviderFundAccountId",
    "MaskedAccountNumber","Amount","Currency","RequestedAt","CreatedByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [a.id, a.payoutObligationId, a.attemptNumber, a.provider, a.providerPayoutId, a.idempotencyKey, a.requestKey, a.beneficiaryId, a.providerFundAccountId, a.maskedAccountNumber,
      a.amount.toFixed(2), a.currency, a.requestedAt, a.createdByUserId]);
}

const request = (a: PayoutAttempt) => ({ providerPayoutId: a.providerPayoutId, idempotencyKey: a.idempotencyKey, fundAccountId: a.providerFundAccountId, amount: a.amount,
  currency: a.currency, reference: a.payoutObligationId.replace(/-/g, "") });

/** SHA-256 of the provider observation exactly as .NET serialized GatewayPayout (or null). */
const payloadHash = (r: GatewayPayout | null) => netFingerprint(r && { Id: r.id, FundAccountId: r.fundAccountId, Amount: netDecimal(r.amount.toFixed(2)), Currency: r.currency,
  Reference: r.reference, Status: netInt(enumIndex(r.status, GATEWAY_PAYOUT_STATUSES)), EventId: r.eventId });

const beneficiaryView = (b: Beneficiary) => ({ id: b.id, maskedAccountNumber: b.maskedAccountNumber, accountHolderName: b.accountHolderName, bankName: b.bankName, ifsc: b.ifsc,
  status: snakeUpper(b.status), createdAt: b.createdAt, availableAt: b.availableAt });
