import type { FastifyInstance } from "fastify";
import { paymentController } from "../../../../features/payment/payment.controller.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

export default async function paymentRoutes(app: FastifyInstance) {
  const c = paymentController(app.services.payments);
  const auth = { preHandler: app.authenticate, schema: { tags: ["Payments"] } };
  app.get(`/contributions/:contributionId${G}/payment-eligibility`, auth, bind(c.eligibility));
  app.post(`/contributions/:contributionId${G}/payments`, auth, bind(c.create));
  app.post(`/payments/:id${G}/verify`, auth, bind(c.verify));
  app.post(`/payments/:id${G}/refresh`, auth, bind(c.refresh));
  app.get(`/payments/:id${G}`, auth, bind(c.details(false)));
  app.get("/payments", auth, bind(c.list(false)));
  app.get("/payments/", auth, bind(c.list(false)));
  const admin = { preHandler: app.requireRoles(...Policies.adminOnly), schema: { tags: ["Admin Payments"] } };
  app.get("/admin/payments", admin, bind(c.list(true)));
  app.get("/admin/payments/", admin, bind(c.list(true)));
  app.get(`/admin/payments/:id${G}`, admin, bind(c.details(true)));
  app.post(`/admin/payments/:id${G}/reconcile`, admin, bind(c.reconcile));
  // Anonymous; the raw-body plugin hands this route the exact signed bytes.
  app.post("/payments/webhooks/razorpay", { schema: { tags: ["Payments"] }, bodyLimit: 1024 * 1024 + 1 }, bind(c.webhook));
}
