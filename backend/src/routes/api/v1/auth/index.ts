import type { FastifyInstance } from "fastify";
import { bind } from "../../../../utils/http.js";
import { authController } from "../../../../features/auth/auth.controller.js";
import * as s from "../../../../features/auth/auth.schema.js";
import { authenticationLimit, passwordResetLimit } from "../rate-limits.js";

export default async function authRoutes(app: FastifyInstance) {
  const c = authController(app.services.auth, app.config);
  const tags = ["Authentication"];
  app.post("/auth/register", { schema: { tags, body: s.registerBody } }, bind(c.register));
  app.post("/auth/login", { schema: { tags, body: s.loginBody }, config: authenticationLimit }, bind(c.login));
  app.post("/auth/refresh", { schema: { tags, body: s.refreshBody } }, bind(c.refresh));
  app.post("/auth/logout", { schema: { tags, body: s.refreshBody } }, bind(c.logout));
  app.post("/auth/forgot-password", { schema: { tags, body: s.forgotBody }, config: passwordResetLimit }, bind(c.forgotPassword));
  app.post("/auth/reset-password", { schema: { tags, body: s.resetBody }, config: passwordResetLimit }, bind(c.resetPassword));
  const users = ["Users"];
  app.get("/users/me", { schema: { tags: users }, preHandler: app.authenticate }, bind(c.me));
  app.put("/users/me", { schema: { tags: users, body: s.profileBody }, preHandler: app.authenticate }, bind(c.updateMe));
  app.put("/users/me/password", { schema: { tags: users, body: s.changePasswordBody }, preHandler: app.authenticate }, bind(c.changePassword));
}
