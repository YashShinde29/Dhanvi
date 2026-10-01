import "@fastify/cookie";
import type { AppConfig } from "../config/index.js";
import type { Services } from "../infra/container.js";
import type { Actor } from "./common.types.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    services: Services;
    /** 401 (empty body, WWW-Authenticate: Bearer) unless a valid access token is present. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Policy guard: authenticated and holding one of the roles, else 403. */
    requireRoles: (...roles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    principal: { userId: string; roles: string[] } | null;
    /** Exact request bytes, kept for HMAC verification (Razorpay webhook). */
    rawBody?: Buffer;
    correlationId: string;
    actor(): Actor;
  }
}
