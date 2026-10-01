import type { Logger } from "pino";
import type { AppConfig } from "../config/index.js";
import { AdminOperationsService } from "../features/admin/admin.service.js";
import { AuctionService } from "../features/auction/auction.service.js";
import { AuthService, type PasswordResetDelivery } from "../features/auth/auth.service.js";
import { TokenService } from "../features/auth/token.service.js";
import { CycleService } from "../features/cycle/cycle.service.js";
import { GroupService } from "../features/group/group.service.js";
import { LedgerPostingService } from "../features/ledger/ledger.posting.js";
import { LedgerQueries } from "../features/ledger/ledger.queries.js";
import { OrganizerService } from "../features/organizer/organizer.service.js";
import { PaymentService } from "../features/payment/payment.service.js";
import { PayoutService } from "../features/payout/payout.service.js";
import { createSeed } from "../features/random-draw/random-draw.algorithm.js";
import { RandomDrawService, type SeedSource } from "../features/random-draw/random-draw.service.js";
import type { AuctionQueue } from "../queues/auction.queue.js";
import { AuctionScheduler } from "../services/auction-scheduler.service.js";
import { FakePayoutGateway, type PayoutGateway } from "../services/payout-gateway.service.js";
import type { Clock } from "../types/common.types.js";
import type { Database } from "./database/db.js";
import { type PaymentGateway, RazorpayGateway } from "./razorpay/razorpay.gateway.js";

export interface ContainerOptions {
  config: AppConfig; db: Database; clock: Clock; log: Logger; auctionQueue: AuctionQueue | null;
  paymentGateway?: PaymentGateway; payoutGateway?: PayoutGateway; seed?: SeedSource; deliverReset?: PasswordResetDelivery;
}

/** One instance of every feature service per process, all sharing the single pool and clock. */
export function createServices(o: ContainerOptions) {
  const { config, db, clock, log } = o;
  const tokens = new TokenService(config.auth);
  const ledger = new LedgerPostingService(clock, config.finance.ledger.feeRecognition);
  const scheduler = new AuctionScheduler(o.auctionQueue, db, clock, log, config.auction.automationEnabled);
  const auctions = new AuctionService(db, clock, config.auction, config.groupPolicy, ledger, scheduler);
  scheduler.attach(auctions);
  // No email/SMS provider is part of this migration: reset requests are logged without the token.
  const deliverReset: PasswordResetDelivery = o.deliverReset ?? (async () => { log.info({ operation: "auth.forgot_password" }, "Password reset requested; no email provider is configured."); });
  const paymentGateway = o.paymentGateway ?? new RazorpayGateway(config.finance.razorpay);
  return {
    db, tokens, ledger, scheduler, auctions,
    auth: new AuthService(db, tokens, config.auth, clock, deliverReset),
    organizers: new OrganizerService(db, clock),
    groups: new GroupService(db, clock, config.groupPolicy, config.finance.razorpay.enabled),
    cycles: new CycleService(db, clock, ledger, config.groupPolicy),
    randomDraws: new RandomDrawService(db, clock, ledger, o.seed ?? createSeed),
    ledgerQueries: new LedgerQueries(db),
    payments: new PaymentService(db, clock, paymentGateway, ledger, config.finance.razorpay),
    payouts: new PayoutService(db, clock, ledger, o.payoutGateway ?? new FakePayoutGateway(db, config.finance.payouts.fakeOutcome)),
    admin: new AdminOperationsService(db, clock),
  };
}
export type Services = ReturnType<typeof createServices>;
