import type { FakePayoutOutcome } from "../config/payment.js";
import type { Database } from "../infra/database/db.js";
import { requireRule } from "../utils/errors.js";
import type { Decimal } from "../utils/money.js";
import { validatePayoutAmount, type GatewayPayoutStatus } from "../features/payout/payout.domain.js";

export interface GatewayPayoutRequest { providerPayoutId: string; idempotencyKey: string; fundAccountId: string; amount: Decimal; currency: string; reference: string }
export interface GatewayPayout { id: string; fundAccountId: string; amount: Decimal; currency: string; reference: string; status: GatewayPayoutStatus; eventId: string }

export interface PayoutGateway {
  readonly provider: string;
  createFundAccount(reference: string): Promise<string>;
  initiatePayout(request: GatewayPayoutRequest): Promise<GatewayPayout>;
  getPayoutStatus(providerId: string): Promise<GatewayPayout | null>;
}

/**
 * Port of FakePayoutGateway: an independent, durable fake provider (payouts."FakeProviderPayouts") so request
 * recovery works across restarts. Only FAKE test payouts exist; no real money moves and no credentials are used.
 * The provider is idempotent on IdempotencyKey and refuses a reused key with different instructions.
 */
export class FakePayoutGateway implements PayoutGateway {
  readonly provider = "FAKE";
  constructor(private readonly db: Database, private readonly outcome: FakePayoutOutcome) {}

  async createFundAccount(reference: string): Promise<string> {
    return `fake_fa_${reference.replace(/-/g, "")}`;
  }

  async initiatePayout(r: GatewayPayoutRequest): Promise<GatewayPayout> {
    validatePayoutAmount(r.amount);
    requireRule(r.currency === "INR" && r.providerPayoutId.startsWith("fake_po_") && r.fundAccountId.startsWith("fake_fa_"), "PAYOUT_NOT_READY", "Only fake test payouts are supported.");
    return this.db.transaction(async (tx) => {
      await tx.advisoryLock(r.idempotencyKey, 91);
      let row = await tx.maybeOne<Record<string, unknown>>(`SELECT * FROM payouts."FakeProviderPayouts" WHERE "IdempotencyKey" = $1`, [r.idempotencyKey]);
      if (!row) {
        await tx.execute(`INSERT INTO payouts."FakeProviderPayouts" ("Id","IdempotencyKey","FundAccountId","Amount","Currency","Reference","Status","Revision") VALUES ($1,$2,$3,$4,$5,$6,$7,0)`,
          [r.providerPayoutId, r.idempotencyKey, r.fundAccountId, r.amount.toFixed(2), r.currency, r.reference, this.outcome]);
        row = { Id: r.providerPayoutId, FundAccountId: r.fundAccountId, Amount: r.amount, Currency: r.currency, Reference: r.reference, Status: this.outcome, Revision: 0 };
      }
      const view = toView(row);
      requireRule(view.id === r.providerPayoutId && view.fundAccountId === r.fundAccountId && view.amount.eq(r.amount) && view.currency === r.currency && view.reference === r.reference,
        "PAYOUT_AMOUNT_MISMATCH", "A provider idempotency key cannot be reused with different instructions.");
      return view;
    });
  }

  async getPayoutStatus(providerId: string): Promise<GatewayPayout | null> {
    const row = await this.db.maybeOne<Record<string, unknown>>(`SELECT * FROM payouts."FakeProviderPayouts" WHERE "Id" = $1`, [providerId]);
    return row && toView(row);
  }
}

const toView = (r: Record<string, unknown>): GatewayPayout => ({
  id: r.Id as string, fundAccountId: r.FundAccountId as string, amount: r.Amount as Decimal, currency: r.Currency as string, reference: r.Reference as string,
  status: r.Status as GatewayPayoutStatus, eventId: `${r.Id as string}:${r.Revision as number}`,
});
