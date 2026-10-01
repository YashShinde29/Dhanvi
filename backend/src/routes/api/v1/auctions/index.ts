import type { FastifyInstance } from "fastify";
import { auctionController } from "../../../../features/auction/auction.controller.js";
import { bidBody, historyQuery, rescheduleBody } from "../../../../features/auction/auction.schema.js";
import { Policies } from "../../../../plugins/auth.js";
import { bind, G } from "../../../../utils/http.js";

export default async function auctionRoutes(app: FastifyInstance) {
  const c = auctionController(app.services.auctions);
  const base = `/groups/:groupId${G}/cycles/:cycleId${G}/auction`; const tags = ["Auctions"]; const auth = { preHandler: app.authenticate };
  app.get(base, { ...auth, schema: { tags } }, bind(c.get));
  app.get(`${base}/my-bids`, { ...auth, schema: { tags } }, bind(c.myBids));
  app.get(`${base}/result`, { ...auth, schema: { tags } }, bind(c.result));
  app.get(`${base}/schedule-history`, { ...auth, schema: { tags, querystring: historyQuery(5) } }, bind(c.scheduleHistory));
  app.post(`${base}/bids`, { ...auth, schema: { tags, body: bidBody } }, bind(c.bid));
  for (const scope of ["organizer", "admin"] as const) {
    const guard = { preHandler: app.requireRoles(...(scope === "admin" ? Policies.adminOnly : Policies.organizerOnly)) };
    app.post(`/${scope}${base}/open`, { ...guard, schema: { tags } }, bind(c.open));
    app.post(`/${scope}${base}/close`, { ...guard, schema: { tags } }, bind(c.close));
    // One use case behind both namespaces; authority (admin: any group, organizer: own group) comes from the session.
    app.post(`/${scope}${base}/reschedule`, { ...guard, schema: { tags, body: rescheduleBody } }, bind(c.reschedule));
    app.get(`/${scope}/groups/:groupId${G}/auction-schedule-history`, { ...guard, schema: { tags, querystring: historyQuery(20) } }, bind(c.groupScheduleHistory));
  }
}
