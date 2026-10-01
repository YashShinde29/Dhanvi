import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/index.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../plugins/auth.js";
import { clientIp, noContent } from "../../utils/http.js";
import type { AuthService } from "./auth.service.js";
import type { AuthenticationResponse } from "./auth.types.js";
import type { changePasswordBody, forgotBody, loginBody, profileBody, refreshBody, registerBody, resetBody } from "./auth.schema.js";
import type { z } from "zod";

/** HTTP mapping for identity, including the HttpOnly SameSite=Strict cookies the web apps rely on (AuthenticationCookies). */
export function authController(auth: AuthService, config: AppConfig) {
  const write = (reply: FastifyReply, r: AuthenticationResponse) => {
    const common = { httpOnly: true, secure: config.auth.secureCookies, sameSite: "strict" as const, path: "/" };
    reply.setCookie(ACCESS_COOKIE, r.accessToken, { ...common, maxAge: r.expiresIn });
    reply.setCookie(REFRESH_COOKIE, r.refreshToken, { ...common, maxAge: config.auth.refreshTokenDays * 86_400 });
  };
  const clear = (reply: FastifyReply) => { reply.clearCookie(ACCESS_COOKIE, { path: "/" }); reply.clearCookie(REFRESH_COOKIE, { path: "/" }); };
  return {
    register: async (req: FastifyRequest<{ Body: z.output<typeof registerBody> }>) => auth.register(req.body, req.correlationId),
    login: async (req: FastifyRequest<{ Body: z.output<typeof loginBody> }>, reply: FastifyReply) => {
      const r = await auth.login(req.body.email, req.body.password, clientIp(req), req.correlationId);
      write(reply, r); return r;
    },
    refresh: async (req: FastifyRequest<{ Body: z.output<typeof refreshBody> }>, reply: FastifyReply) => {
      const token = req.body?.refreshToken ?? req.cookies[REFRESH_COOKIE];
      if (!token?.trim()) return reply.status(401).send();
      const r = await auth.refresh(token, clientIp(req));
      write(reply, r); return r;
    },
    logout: async (req: FastifyRequest<{ Body: z.output<typeof refreshBody> }>, reply: FastifyReply) => {
      const token = req.body?.refreshToken ?? req.cookies[REFRESH_COOKIE];
      if (token?.trim()) await auth.logout(token, clientIp(req));
      clear(reply); return noContent(reply);
    },
    forgotPassword: async (req: FastifyRequest<{ Body: z.output<typeof forgotBody> }>) => {
      await auth.forgotPassword(req.body.email);
      return { message: "If an account exists, password reset instructions have been sent." };
    },
    resetPassword: async (req: FastifyRequest<{ Body: z.output<typeof resetBody> }>, reply: FastifyReply) => {
      await auth.resetPassword(req.body.token, req.body.newPassword, req.correlationId);
      clear(reply); return { message: "Password has been reset. Please sign in again." };
    },
    me: async (req: FastifyRequest) => auth.currentUser(req.actor().userId),
    updateMe: async (req: FastifyRequest<{ Body: z.output<typeof profileBody> }>) => auth.updateProfile(req.actor().userId, req.body),
    changePassword: async (req: FastifyRequest<{ Body: z.output<typeof changePasswordBody> }>, reply: FastifyReply) => {
      await auth.changePassword(req.actor().userId, req.body.currentPassword, req.body.newPassword, req.correlationId);
      clear(reply); return noContent(reply);
    },
  };
}
