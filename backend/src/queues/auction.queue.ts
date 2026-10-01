import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const AUCTION_QUEUE = "dhanvi-auction";

export type AuctionJobName = "OPEN_AUCTION" | "START_CLOSING_SEQUENCE" | "ADVANCE_GOING_ONCE" | "ADVANCE_GOING_TWICE" | "ADVANCE_FINAL_CALL" | "FINALIZE_AUCTION" | "AUCTION_SWEEP";

/** Every job carries the state it was scheduled for; the worker re-reads PostgreSQL and NO-OPs when it moved on. */
export interface AuctionJobData {
  groupId?: string;
  cycleId?: string;
  auctionId?: string;
  expectedStartsAt?: number;
  expectedClosingVersion?: number;
  /** Present (possibly null) only when the job must target one specific highest bid. */
  expectedHighestBidId?: string | null;
}

export const createAuctionQueue = (connection: Redis) => new Queue<AuctionJobData, unknown, AuctionJobName>(AUCTION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2_000 },
    // Completed jobs are removed so a later, still-valid schedule can reuse the deterministic id; failures are kept for review.
    removeOnComplete: true,
    removeOnFail: { count: 5_000 },
  },
});
export type AuctionQueue = ReturnType<typeof createAuctionQueue>;
