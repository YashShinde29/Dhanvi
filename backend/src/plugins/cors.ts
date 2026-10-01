import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/** Explicit browser origins only (member app 3000, admin app 3001). Never a wildcard with credentials. */
export default fp(async (app: FastifyInstance) => {
  await app.register(cors, { origin: app.config.frontendOrigins, credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    exposedHeaders: ["X-Correlation-ID"] });
}, { name: "cors" });
