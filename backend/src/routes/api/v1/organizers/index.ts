import type { FastifyInstance } from "fastify";
import { organizerController } from "../../../../features/organizer/organizer.controller.js";
import * as s from "../../../../features/organizer/organizer.schema.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

export default async function organizerRoutes(app: FastifyInstance) {
  const c = organizerController(app.services.organizers);
  app.post("/organizers/apply", { schema: { tags: ["Organizers"], body: s.applyBody }, preHandler: app.authenticate }, bind(c.apply));
  app.get("/organizers/me", { schema: { tags: ["Organizers"] }, preHandler: app.authenticate }, bind(c.me));
  const admin = { preHandler: app.requireRoles(...Policies.adminOnly) };
  app.get("/admin/organizer-applications", { ...admin, schema: { tags: ["Administration"], querystring: s.applicationsQuery } }, bind(c.applications));
  app.post(`/admin/organizer-applications/:applicationId${G}/approve`, { ...admin, schema: { tags: ["Administration"] } }, bind(c.approve));
  app.post(`/admin/organizer-applications/:applicationId${G}/reject`, { ...admin, schema: { tags: ["Administration"], body: s.rejectBody } }, bind(c.reject));
  app.post(`/admin/organizers/:userId${G}/suspend`, { ...admin, schema: { tags: ["Administration"] } }, bind(c.suspend));
}
