import type { FastifyInstance } from "fastify";
import { payoutController } from "../../../../features/payout/payout.controller.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";
import { authenticationLimit } from "../rate-limits.js";

export default async function payoutRoutes(app: FastifyInstance) {
  const c = payoutController(app.services.payouts, app.services.auth);
  const admin = { preHandler: app.requireRoles(...Policies.adminOnly), schema: { tags: ["Admin Payouts"] } };
  app.get("/admin/payouts", admin, bind(c.adminList));
  app.get("/admin/payouts/", admin, bind(c.adminList));
  app.get(`/admin/payouts/:id${G}`, admin, bind(c.details(true)));
  app.post(`/admin/payouts/:id${G}/approve`, admin, bind(c.approve));
  app.post(`/admin/payouts/:id${G}/execute`, admin, bind(c.execute(false)));
  app.post(`/admin/payouts/:id${G}/retry`, admin, bind(c.execute(true)));
  app.post(`/admin/payouts/:id${G}/reconcile`, admin, bind(c.reconcile));
  app.post(`/admin/cycles/:cycleId${G}/prepare-settlement`, admin, bind(c.prepare));
  app.post(`/admin/cycles/:cycleId${G}/evaluate-settlement`, admin, bind(c.evaluate));
  const auth = { preHandler: app.authenticate, schema: { tags: ["My Payouts"] } };
  app.get("/me/payouts", auth, bind(c.myList));
  app.get("/me/payouts/", auth, bind(c.myList));
  app.get(`/me/payouts/:id${G}`, auth, bind(c.details(false)));
  app.get(`/organizer/groups/:groupId${G}/payouts`, { preHandler: app.requireRoles(...Policies.organizerOnly), schema: { tags: ["Payouts"] } }, bind(c.organizerList));
  app.get("/users/me/payout-account", auth, bind(c.account));
  app.post("/users/me/payout-account", { ...auth, config: authenticationLimit }, bind(c.addAccount));
}
