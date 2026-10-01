import type { FastifyError, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { DhanviError } from "../utils/errors.js";

/**
 * Port of GlobalExceptionHandler: ProblemDetails {type, title, status, detail, instance, code?, traceId, errors?} with the
 * same status/type/code mapping. Raw PostgreSQL or provider errors never reach clients; 500s are logged server-side.
 */
export default fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const problem = (status: number, type: string, message: string, extra: Record<string, unknown> = {}) =>
      reply.status(status).type("application/json; charset=utf-8").send({ type, title: message, status, detail: message, instance: request.url.split("?")[0], ...extra, traceId: request.correlationId });

    if (error instanceof DhanviError) {
      if (error.status >= 500) request.log.error({ err: error }, "service error");
      else request.log.info({ operation: request.routeOptions.url, code: error.code ?? error.type, status: error.status }, "request rejected");
      return problem(error.status, error.type, error.message, { ...(error.code ? { code: error.code } : {}), ...(error.errors ? { errors: error.errors } : {}) });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors: Record<string, string[]> = {};
      for (const issue of error.validation) {
        const key = (issue.instancePath || "").replace(/^\//, "").replace(/\//g, ".") || (issue.params as { issue?: { path?: unknown[] } })?.issue?.path?.join(".") || "request";
        (errors[key] ??= []).push(issue.message ?? "Invalid value.");
      }
      return problem(400, "validation_error", "One or more validation errors occurred.", { errors });
    }
    if (error.statusCode === 429) return reply.status(429).send();
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return problem(error.statusCode === 413 ? 413 : 400, "validation_error", error.statusCode === 413 ? "Request body is too large." : "The request body or parameters are invalid.");
    request.log.error({ err: error, method: request.method, url: request.url }, "Unhandled exception while processing request");
    return problem(500, "server_error", "The request could not be completed.");
  });
  app.setNotFoundHandler((request, reply) => reply.status(404).send());
}, { name: "error-handler" });
