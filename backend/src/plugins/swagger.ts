import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

/** OpenAPI 3 document generated from the route zod schemas; UI at /swagger (development by default). */
export default fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      info: { title: "Dhanvi API", version: "v1" },
      components: { securitySchemes: { Bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
      security: [{ Bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/swagger" });
}, { name: "swagger" });
