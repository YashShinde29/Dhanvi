import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Logger } from "pino";
import type { AppConfig } from "./config/index.js";
import type { Services } from "./infra/container.js";
import authPlugin from "./plugins/auth.js";
import corsPlugin from "./plugins/cors.js";
import errorHandler from "./plugins/error-handler.js";
import rawBody from "./plugins/raw-body.js";
import requestContext from "./plugins/request-context.js";
import swaggerPlugin from "./plugins/swagger.js";
import routes from "./routes/index.js";

/** Never log secrets, tokens, OTPs, passwords or bank details. */
export const REDACT = ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-razorpay-signature\"]", "res.headers[\"set-cookie\"]",
  "*.password", "*.newPassword", "*.currentPassword", "*.accountNumber", "*.confirmAccountNumber", "*.token", "*.refreshToken", "*.accessToken"];

export interface BuildOptions { config: AppConfig; services: Services; logger: Logger | boolean }

/** Builds the HTTP application. No listening, no process concerns — server.ts and the tests own those. */
export async function buildApp({ config, services, logger }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: typeof logger === "boolean" ? undefined : logger,
    logger: typeof logger === "boolean" ? logger : undefined,
    trustProxy: config.trustProxy,
    requestIdHeader: false,
  }) as unknown as FastifyInstance;
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("services", services);

  await app.register(requestContext);
  await app.register(errorHandler);
  await app.register(cookie);
  await app.register(corsPlugin);
  await app.register(rateLimit, { global: false, keyGenerator: (req) => req.ip, errorResponseBuilder: () => Object.assign(new Error("Too many requests"), { statusCode: 429 }) });
  await app.register(rawBody);
  await app.register(authPlugin);
  if (config.swaggerEnabled) await app.register(swaggerPlugin);
  await app.register(routes);
  return app;
}
