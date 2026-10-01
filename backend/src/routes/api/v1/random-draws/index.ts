import type { FastifyInstance } from "fastify";
import { randomDrawController } from "../../../../features/random-draw/random-draw.controller.js";
import { bind, G } from "../../../../utils/http.js";

export default async function selectionRoutes(app: FastifyInstance) {
  const c = randomDrawController(app.services.randomDraws);
  const base = `/groups/:groupId${G}/cycles/:cycleId${G}/selection`; const o = { preHandler: app.authenticate, schema: { tags: ["Selection"] } };
  app.post(base, o, bind(c.execute));
  app.get(base, o, bind(c.get));
  app.get(`${base}/preview`, o, bind(c.preview));
  app.get(`${base}/verify`, o, bind(c.verify));
}
