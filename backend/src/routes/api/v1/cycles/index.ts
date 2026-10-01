import type { FastifyInstance } from "fastify";
import { cycleController } from "../../../../features/cycle/cycle.controller.js";
import { recordBody, reverseBody } from "../../../../features/cycle/cycle.schema.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

/** Cycles and contributions (memberships, cycles and contribution routes of the .NET CycleEndpoints). */
export default async function cycleRoutes(app: FastifyInstance) {
  const c = cycleController(app.services.cycles);
  const auth = { preHandler: app.authenticate }; const tags = ["Cycles and contributions"];
  app.post(`/groups/:groupId${G}/activate`, { ...auth, schema: { tags } }, bind(c.activate));
  app.get(`/groups/:groupId${G}/cycles`, { ...auth, schema: { tags } }, bind(c.cycles(false)));
  app.get(`/groups/:groupId${G}/cycles/:cycleId${G}`, { ...auth, schema: { tags } }, bind(c.cycle));
  app.get(`/groups/:groupId${G}/my-contributions`, { ...auth, schema: { tags } }, bind(c.myGroupContributions));
  app.get("/me/contributions", { ...auth, schema: { tags: ["My contributions"] } }, bind(c.myContributions));
  for (const scope of ["organizer", "admin"] as const) {
    const guard = { preHandler: app.requireRoles(...(scope === "admin" ? Policies.adminOnly : Policies.organizerOnly)) };
    const t = [`${scope} contributions`]; const base = `/${scope}/groups/:groupId${G}`;
    app.get(`${base}/cycles`, { ...guard, schema: { tags: t } }, bind(c.cycles(true)));
    app.get(`${base}/cycles/:cycleId${G}/contributions`, { ...guard, schema: { tags: t } }, bind(c.cycleContributions));
    app.post(`${base}/cycles/:cycleId${G}/contributions/:contributionId${G}/record`, { ...guard, schema: { tags: t, body: recordBody } }, bind(c.record));
    app.post(`${base}/cycles/:cycleId${G}/contributions/:contributionId${G}/reverse`, { ...guard, schema: { tags: t, body: reverseBody } }, bind(c.reverse));
    app.post(`${base}/mark-overdue`, { ...guard, schema: { tags: t } }, bind(c.markOverdue));
  }
}
