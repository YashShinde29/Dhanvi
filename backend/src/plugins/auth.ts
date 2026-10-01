import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { UnauthorizedError } from "../utils/errors.js";

export const ACCESS_COOKIE = "dhanvi_access";
export const REFRESH_COOKIE = "dhanvi_refresh";

/**
 * Bearer token first, else the HttpOnly dhanvi_access cookie (JwtBearerEvents.OnMessageReceived). Authorization is
 * always decided here and in services — never by the frontend's role checks.
 */
export default fp(async (app: FastifyInstance) => {
  app.decorateRequest("principal", null);
  app.decorateRequest("actor", function (this: FastifyRequest) {
    if (!this.principal) throw new UnauthorizedError();
    return { userId: this.principal.userId, isAdmin: this.principal.roles.includes("ADMIN") || this.principal.roles.includes("SUPER_ADMIN") };
  });
  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    const token = header?.trim() ? (/^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? null) : (request.cookies[ACCESS_COOKIE] ?? null);
    if (!token) return;
    request.principal = await app.services.tokens.verify(token);
    if (request.principal) request.log = request.log.child({ userId: request.principal.userId });
  });
  const unauthorized = (reply: FastifyReply) => reply.status(401).header("WWW-Authenticate", "Bearer").send();
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.principal) return unauthorized(reply);
  });
  app.decorate("requireRoles", (...roles: string[]) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.principal) return unauthorized(reply);
    if (!request.principal.roles.some((r) => roles.includes(r))) return reply.status(403).send();
  });
}, { name: "auth", dependencies: ["@fastify/cookie"] });

/** AuthorizationPolicies */
export const Policies = { organizerOnly: ["ORGANIZER"], adminOnly: ["ADMIN", "SUPER_ADMIN"], superAdminOnly: ["SUPER_ADMIN"] } as const;
