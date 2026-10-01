import { type Job, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { AutomationOutcome } from "../features/auction/auction.service.js";
import type { Services } from "../infra/container.js";
import { AUCTION_QUEUE, type AuctionJobData, type AuctionJobName } from "../queues/auction.queue.js";

/**
 * Pure job processor (also used directly by tests). OPEN_AUCTION opens the auction at StartsAt; the closing jobs and
 * FINALIZE_AUCTION all funnel into one locked, version-checked state transition, then the next step is scheduled.
 */
export async function processAuctionJob(services: Services, name: AuctionJobName, data: AuctionJobData, jobId: string): Promise<AutomationOutcome | { swept: number }> {
  if (name === "AUCTION_SWEEP") return { swept: await services.scheduler.sweep() };
  if (!data.groupId || !data.cycleId) return { outcome: "NOOP", reason: "INVALID_JOB" };
  if (name === "OPEN_AUCTION") return services.auctions.automationOpen(data.groupId, data.cycleId, data.expectedStartsAt ?? -1, jobId);
  return services.auctions.automationClose(data.groupId, data.cycleId, {
    closingVersion: data.expectedClosingVersion ?? -1,
    ...("expectedHighestBidId" in data ? { highestBidId: data.expectedHighestBidId ?? null } : {}),
  }, jobId);
}

export function startAuctionWorker(services: Services, connection: Redis, log: Logger, concurrency: number) {
  const worker = new Worker<AuctionJobData, unknown, AuctionJobName>(AUCTION_QUEUE, async (job: Job<AuctionJobData, unknown, AuctionJobName>) => {
    const outcome = await processAuctionJob(services, job.name, job.data, job.id ?? "unknown");
    log.info({ operation: `auction.${job.name}`, jobId: job.id, groupId: job.data.groupId, cycleId: job.data.cycleId, outcome }, "auction job processed");
    return outcome;
  }, { connection, concurrency });
  worker.on("failed", (job, err) => log.error({ operation: `auction.${job?.name}`, jobId: job?.id, err, code: (err as { code?: string }).code }, "auction job failed"));
  return worker;
}
