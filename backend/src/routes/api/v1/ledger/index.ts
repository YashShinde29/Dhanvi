import type { FastifyInstance } from "fastify";
import { ledgerController } from "../../../../features/ledger/ledger.controller.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

/** Read-only. There is deliberately no HTTP endpoint that posts journals. */
export default async function ledgerRoutes(app: FastifyInstance) {
  const c = ledgerController(app.services.ledgerQueries);
  const admin = { preHandler: app.requireRoles(...Policies.adminOnly), schema: { tags: ["Ledger"] } };
  app.get("/admin/ledger/accounts", admin, bind(c.accounts));
  app.get("/admin/ledger/journals", admin, bind(c.journals));
  app.get(`/admin/ledger/journals/:id${G}`, admin, bind(c.journal));
  app.get("/admin/ledger/trial-balance", admin, bind(c.trialBalance));
  app.get(`/admin/ledger/groups/:groupId${G}`, admin, bind(c.groupJournals));
  app.get(`/admin/ledger/groups/:groupId${G}/balances`, admin, bind(c.groupBalances));
  app.get("/admin/ledger/accounts/:code/balance", admin, bind(c.accountBalance));
  app.get("/me/ledger", { preHandler: app.authenticate, schema: { tags: ["My ledger"] } }, bind(c.member));
}
