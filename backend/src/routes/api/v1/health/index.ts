import type { FastifyInstance } from "fastify";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { tags: ["Health"] } }, async () => ({ status: "healthy", application: "Dhanvi API" }));
  app.get("/health/ready", { schema: { tags: ["Health"] } }, async (_req, reply) => {
    try { await app.services.db.query("SELECT 1"); return "Healthy"; } catch { return reply.status(503).send("Unhealthy"); }
  });
}
