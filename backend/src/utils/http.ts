import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import type { Actor } from "../types/common.types.js";

/** GUID route constraint (ASP.NET `{id:guid}`): a non-GUID segment does not match the route and yields 404. */
export const G = "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

export const param = (request: FastifyRequest, name: string): string => ((request.params as Record<string, string>)[name] ?? "").toLowerCase();
export const query = (request: FastifyRequest): Record<string, string | undefined> => request.query as Record<string, string | undefined>;
export const header = (request: FastifyRequest, name: string): string => {
  const v = request.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
};
export const optionalActor = (request: FastifyRequest): Actor | null => (request.principal ? request.actor() : null);
export const noContent = (reply: FastifyReply) => reply.status(204).send();
export const clientIp = (request: FastifyRequest): string | null => request.ip ?? null;

/** Binds a controller handler whose request generics come from the route's zod schema (validated before the handler runs). */
export const bind = (fn: (...args: never[]) => unknown) => fn as unknown as RouteHandlerMethod;
