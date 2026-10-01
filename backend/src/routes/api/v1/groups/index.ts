import type { FastifyInstance } from "fastify";
import { groupController } from "../../../../features/group/group.controller.js";
import { acceptTermsBody, reasonBody, saveGroupBody } from "../../../../features/group/group.schema.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

export default async function groupRoutes(app: FastifyInstance) {
  const c = groupController(app.services.groups);
  const tags = ["Groups"]; const auth = { preHandler: app.authenticate };
  app.get("/groups", { schema: { tags } }, bind(c.browsePublic));
  app.get(`/groups/:id${G}`, { schema: { tags } }, bind(c.detailsPublic));
  app.post(`/groups/:id${G}/applications`, { ...auth, schema: { tags } }, bind(c.operation("apply")));
  app.post(`/groups/:id${G}/accept-terms`, { ...auth, schema: { tags, body: acceptTermsBody } }, bind(c.acceptTerms));
  app.get(`/groups/:id${G}/organizer/contact`, { ...auth, schema: { tags } }, bind(c.contact));
  app.post(`/groups/:id${G}/confirm-ready`, { ...auth, schema: { tags } }, bind(c.operation("confirm-ready")));
  app.get("/my-groups", { ...auth, schema: { tags } }, bind(c.browseMine));

  for (const scope of ["organizer", "admin"] as const) {
    const guard = { preHandler: app.requireRoles(...(scope === "admin" ? Policies.adminOnly : Policies.organizerOnly)) };
    const t = [`${scope} groups`]; const base = `/${scope}/groups`;
    app.get(base, { ...guard, schema: { tags: t } }, bind(c.browseScope(scope)));
    app.post(base, { ...guard, schema: { tags: t, body: saveGroupBody } }, bind(c.create(scope === "admin" ? "Platform" : "Organizer")));
    app.get(`${base}/:id${G}`, { ...guard, schema: { tags: t } }, bind(c.detailsManaged));
    app.put(`${base}/:id${G}`, { ...guard, schema: { tags: t, body: saveGroupBody } }, bind(c.update));
    app.post(`${base}/:id${G}/publish`, { ...guard, schema: { tags: t } }, bind(c.operation("publish")));
    app.post(`${base}/:id${G}/confirm-ready`, { ...guard, schema: { tags: t } }, bind(c.operation("confirm-ready")));
    for (const operation of scope === "admin" ? (["suspend", "cancel"] as const) : (["cancel"] as const))
      app.post(`${base}/:id${G}/${operation}`, { ...guard, schema: { tags: t, body: reasonBody } }, bind(c.operation(operation)));
    app.get(`${base}/:id${G}/applications`, { ...guard, schema: { tags: t } }, bind(c.members));
    app.get(`${base}/:id${G}/members`, { ...guard, schema: { tags: t } }, bind(c.members));
    app.post(`${base}/:id${G}/applications/:membershipId${G}/approve`, { ...guard, schema: { tags: t } }, bind(c.operation("approve")));
    app.post(`${base}/:id${G}/applications/:membershipId${G}/reject`, { ...guard, schema: { tags: t, body: reasonBody } }, bind(c.operation("reject")));
  }
}
