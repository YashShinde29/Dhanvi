import type { FastifyRequest } from "fastify";
import { param } from "../../utils/http.js";
import type { RandomDrawService } from "./random-draw.service.js";

export function randomDrawController(draws: RandomDrawService) {
  const ids = (req: FastifyRequest) => [param(req, "groupId"), param(req, "cycleId")] as const;
  return {
    execute: async (req: FastifyRequest) => draws.execute(...ids(req), req.actor()),
    get: async (req: FastifyRequest) => draws.get(...ids(req), req.actor()),
    preview: async (req: FastifyRequest) => draws.preview(...ids(req), req.actor()),
    verify: async (req: FastifyRequest) => draws.verify(...ids(req), req.actor()),
  };
}
