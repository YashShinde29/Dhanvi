import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { parseJsonPreservingDecimals } from "../utils/json.js";

export const RAW_BODY_ROUTES = new Set(["/api/v1/payments/webhooks/razorpay"]);
const BODY_LIMIT = 1024 * 1024;

/**
 * JSON is read as raw bytes. Routes in RAW_BODY_ROUTES (the Razorpay webhook) receive the exact bytes untouched, so the
 * HMAC is verified over what Razorpay signed — never over JSON.stringify(parsedBody). All other JSON is parsed with
 * exact decimals (money never becomes a float). Other content types reach only raw-body routes.
 */
export default fp(async (app: FastifyInstance) => {
  app.removeAllContentTypeParsers();
  const handler = (request: Parameters<Parameters<FastifyInstance["addContentTypeParser"]>[2]>[0], body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
    request.rawBody = body;
    if (RAW_BODY_ROUTES.has(request.routeOptions.url ?? "")) return done(null, body);
    if (body.length === 0) return done(null, undefined);
    try { done(null, parseJsonPreservingDecimals(body.toString("utf8"))); }
    catch { done(Object.assign(new Error("Invalid JSON body."), { statusCode: 400 })); }
  };
  app.addContentTypeParser(["application/json", "application/problem+json"], { parseAs: "buffer", bodyLimit: BODY_LIMIT }, handler);
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: BODY_LIMIT }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if (RAW_BODY_ROUTES.has(request.routeOptions.url ?? "")) return done(null, body);
    done(Object.assign(new Error("Unsupported media type."), { statusCode: 415 }));
  });
}, { name: "raw-body" });
