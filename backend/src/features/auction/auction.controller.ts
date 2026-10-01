import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { BadRequestError } from "../../utils/errors.js";
import { header, param } from "../../utils/http.js";
import { GUID } from "../../utils/schema.js";
import type { bidBody, historyQuery, rescheduleBody } from "./auction.schema.js";
import type { AuctionService } from "./auction.service.js";

type HistoryQuery = z.output<ReturnType<typeof historyQuery>>;

export function auctionController(auctions: AuctionService) {
  const ids = (req: FastifyRequest) => [param(req, "groupId"), param(req, "cycleId")] as const;
  return {
    get: async (req: FastifyRequest) => auctions.get(...ids(req), req.actor()),
    myBids: async (req: FastifyRequest) => auctions.myBids(...ids(req), req.actor()),
    result: async (req: FastifyRequest) => auctions.result(...ids(req), req.actor()),
    scheduleHistory: async (req: FastifyRequest<{ Querystring: HistoryQuery }>) => auctions.scheduleHistory(...ids(req), req.actor(), req.query.page, req.query.pageSize),
    groupScheduleHistory: async (req: FastifyRequest<{ Querystring: HistoryQuery }>) => {
      if (req.query.cycleId && !GUID.test(req.query.cycleId)) throw new BadRequestError("Invalid cycleId.");
      return auctions.groupScheduleHistory(param(req, "groupId"), req.query.cycleId?.toLowerCase(), req.actor(), req.query.page, req.query.pageSize);
    },
    bid: async (req: FastifyRequest<{ Body: z.output<typeof bidBody> }>) => auctions.bid(...ids(req), req.actor(), req.body.discountAmount, header(req, "Idempotency-Key")),
    open: async (req: FastifyRequest) => auctions.open(...ids(req), req.actor()),
    close: async (req: FastifyRequest) => auctions.close(...ids(req), req.actor()),
    reschedule: async (req: FastifyRequest<{ Body: z.output<typeof rescheduleBody> }>) =>
      auctions.reschedule(...ids(req), req.actor(), { ...req.body, reasonCode: req.body.reasonCode ?? null }, header(req, "Idempotency-Key")),
  };
}
