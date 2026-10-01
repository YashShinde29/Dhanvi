import type { Logger } from "pino";
import type { AuctionService, AuctionScheduleSync } from "../features/auction/auction.service.js";
import type { Database } from "../infra/database/db.js";
import type { AuctionQueue } from "../queues/auction.queue.js";
import type { Clock } from "../types/common.types.js";

const RETRY_FAILED_AFTER_MS = 5 * 60_000;

/**
 * Turns committed auction state into the next durable BullMQ job (never setTimeout). Job ids are deterministic
 * (type + auction + ClosingVersion/deadline), so concurrent API/worker instances enqueue each step at most once;
 * correctness still never depends on Redis — every job re-validates against PostgreSQL under row locks.
 */
export class AuctionScheduler implements AuctionScheduleSync {
  private service: AuctionService | null = null;
  constructor(private readonly queue: AuctionQueue | null, private readonly db: Database, private readonly clock: Clock, private readonly log: Logger, private readonly enabled: boolean) {}

  attach(service: AuctionService): void { this.service = service; }

  async sync(target: { groupId: string; cycleId: string }): Promise<void> {
    if (!this.enabled || !this.queue || !this.service) return;
    const next = await this.service.nextJob(target.groupId, target.cycleId);
    if (!next) return;
    const jobId = `${next.type}-${next.jobKey}`.replace(/:/g, "_");
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      // A failed step is retried later instead of hot-looping; waiting/delayed/active jobs are left alone (dedupe).
      if ((await existing.isFailed()) && this.clock.now().getTime() - (existing.finishedOn ?? 0) > RETRY_FAILED_AFTER_MS) await existing.retry();
      return;
    }
    const delay = Math.max(0, next.dueAt.getTime() - this.clock.now().getTime());
    await this.queue.add(next.type, {
      groupId: next.groupId, cycleId: next.cycleId, auctionId: next.auctionId, expectedStartsAt: next.expectedStartsAt, expectedClosingVersion: next.expectedClosingVersion,
      ...(next.expectedHighestBidId !== undefined ? { expectedHighestBidId: next.expectedHighestBidId } : {}),
    }, { jobId, delay });
    this.log.debug({ operation: "auction.schedule", jobId, delay }, "auction job scheduled");
  }

  /** Safety net: re-derives the next job for every auction that can still move, e.g. after Redis lost delayed jobs. */
  async sweep(): Promise<number> {
    const targets = await this.db.query<{ GroupId: string; CycleId: string }>(`
      SELECT a."GroupId", a."CycleId" FROM groups."Auctions" a WHERE a."Status" = 'Open'
      UNION
      SELECT c."GroupId", c."Id" FROM groups."MonthlyCycles" c JOIN groups."Groups" g ON g."Id" = c."GroupId" AND g."Status" = 'Active' AND g."CurrentCycleNumber" = c."CycleNumber"
      WHERE c."SelectionMethod" = 'Auction' AND c."Status" = 'ReadyForSelection'
        AND NOT EXISTS (SELECT 1 FROM groups."Auctions" a WHERE a."CycleId" = c."Id" AND a."Status" <> 'Scheduled')`);
    for (const t of targets) {
      try { await this.sync({ groupId: t.GroupId, cycleId: t.CycleId }); }
      catch (error) { this.log.error({ operation: "auction.sweep", err: error, groupId: t.GroupId, cycleId: t.CycleId }, "auction sweep target failed"); }
    }
    return targets.length;
  }
}
