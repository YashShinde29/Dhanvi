import type { FastifyInstance } from "fastify";
import { adminController } from "../../../../features/admin/admin.controller.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

/** Read-only operational views for the Admin Control Center; commands stay with their modules. */
export default async function adminRoutes(app: FastifyInstance) {
  const c = adminController(app.services.admin);
  const admin = { preHandler: app.requireRoles(...Policies.adminOnly), schema: { tags: ["Admin operations"] } };
  app.get("/admin/operations/overview", admin, bind(c.overview));
  app.get("/admin/groups/operations", admin, bind(c.groups));
  app.get(`/admin/groups/:groupId${G}/operations-summary`, admin, bind(c.group));
}
