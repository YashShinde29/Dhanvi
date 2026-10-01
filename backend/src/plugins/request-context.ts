import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export const CORRELATION_HEADER = "x-correlation-id";

/** Port of CorrelationIdMiddleware: honour a caller's X-Correlation-ID, otherwise generate one; echo it back and log it. */
export default fp(async (app: FastifyInstance) => {
  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", async (request, reply) => {
    const supplied = request.headers[CORRELATION_HEADER];
    const value = typeof supplied === "string" && supplied.trim() ? supplied.trim().slice(0, 100) : randomUUID().replace(/-/g, "");
    request.correlationId = value;
    request.log = request.log.child({ correlationId: value });
    reply.header("X-Correlation-ID", value);
  });
}, { name: "request-context" });
