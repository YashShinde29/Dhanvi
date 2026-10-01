import type { FastifyInstance } from "fastify";
import adminRoutes from "./api/v1/admin/index.js";
import auctionRoutes from "./api/v1/auctions/index.js";
import authRoutes from "./api/v1/auth/index.js";
import cycleRoutes from "./api/v1/cycles/index.js";
import groupRoutes from "./api/v1/groups/index.js";
import healthRoutes from "./api/v1/health/index.js";
import ledgerRoutes from "./api/v1/ledger/index.js";
import organizerRoutes from "./api/v1/organizers/index.js";
import paymentRoutes from "./api/v1/payments/index.js";
import payoutRoutes from "./api/v1/payouts/index.js";
import selectionRoutes from "./api/v1/random-draws/index.js";

/** Every route lives under /api/v1 (the contract both web apps use). */
export default async function routes(app: FastifyInstance) {
  await app.register(async (v1) => {
    for (const module of [healthRoutes, authRoutes, organizerRoutes, groupRoutes, cycleRoutes, selectionRoutes, auctionRoutes, ledgerRoutes, paymentRoutes, payoutRoutes, adminRoutes])
      await v1.register(module);
  }, { prefix: "/api/v1" });
}
