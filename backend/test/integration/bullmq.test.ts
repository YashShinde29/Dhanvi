import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createRedis } from "../../src/config/redis.js";
import { type AuctionQueue, createAuctionQueue } from "../../src/queues/auction.queue.js";
import { startAuctionWorker } from "../../src/workers/auction.worker.js";
import { activeGroup, recordAll } from "../support/fixtures.js";
import { as, createHarness, expectOk, type Harness } from "../support/harness.js";

let h: Harness; let queue: AuctionQueue; let worker: ReturnType<typeof startAuctionWorker>; let qConn: Redis; let wConn: Redis;
const waitFor = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

beforeAll(async () => {
  qConn = createRedis(inject("redisUrl"), "queue"); wConn = createRedis(inject("redisUrl"), "worker");
  queue = createAuctionQueue(qConn);
  await queue.obliterate({ force: true });
  h = await createHarness({ realClock: true, auctionQueue: queue, env: { AUCTION_GOING_ONCE_SECONDS: "1", AUCTION_GOING_TWICE_SECONDS: "1", AUCTION_FINAL_WARNING_SECONDS: "1" } });
  worker = startAuctionWorker(h.services, wConn, pino({ level: "silent" }), 4);
});
afterAll(async () => { await worker.close(); await queue.close(); qConn.disconnect(); wConn.disconnect(); await h.close(); });

describe("BullMQ auction automation (real Redis, real time)", () => {
  it("opens at StartsAt, runs the full closing sequence and finalizes exactly once — even after Redis loses its jobs", async () => {
    const g = await activeGroup(h, { groupType: "AUCTION", members: 4, groupValue: 40000,
      auction: { minimumDiscount: 400, maximumDiscount: 20000, bidIncrement: 400, auctionStartTime: "18:00:00", auctionEndTime: "18:30:00" } });
    const cycleId = g.cycles[0]!.id as string;
    await recordAll(h, g, cycleId);
    const base = `groups/${g.groupId}/cycles/${cycleId}/auction`;
    const start = new Date(Date.now() + 2_500); const end = new Date(start.getTime() + 2_500);
    expectOk(await as(h, g.owner)("POST", `admin/${base}/reschedule`, { newStartsAt: start.toISOString(), newEndsAt: end.toISOString(), reasonCode: "TECHNICAL_ISSUE", expectedScheduleVersion: 0 }, { "idempotency-key": "bq-1" }));
    const delayed = await queue.getDelayed();
    expect(delayed.map((j) => j.name)).toContain("OPEN_AUCTION");
    await waitFor(() => as(h, g.members[0]!)("GET", base).then((r) => r.json().status), (s) => s === "OPEN");
    expectOk(await as(h, g.members[0]!)("POST", `${base}/bids`, '{"discountAmount":2000}', { "idempotency-key": "bq-bid-1" }));
    // Simulate Redis losing every scheduled job: the PostgreSQL-driven sweep rebuilds the next step.
    await queue.obliterate({ force: true });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await h.services.scheduler.sweep()).toBeGreaterThanOrEqual(1);
    const final = await waitFor(() => as(h, g.members[1]!)("GET", base).then((r) => r.json()), (a) => a.status === "WINNER_SELECTED", 40_000);
    expect(final).toMatchObject({ closingState: "COMPLETED", result: { winningDiscount: 2000, winnerPayout: 38000 } });
    for (const table of ["SelectionResults", "AuctionResults"])
      expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."${table}" WHERE "CycleId" = $1`, [cycleId])).count).toBe(1);
    const actions = (await h.db.query<{ Action: string }>(`SELECT "Action" FROM groups."GroupAuditEvents" WHERE "CycleId" = $1 ORDER BY "CreatedAt"`, [cycleId])).map((a) => a.Action);
    expect(actions).toEqual(expect.arrayContaining(["AUCTION_OPENED", "AUCTION_BID_SUBMITTED", "AUCTION_CLOSING_STARTED", "AUCTION_CLOSING_GOING_TWICE", "AUCTION_CLOSING_FINAL_WARNING", "AUCTION_FINALIZING", "AUCTION_WINNER_SELECTED"]));
    expect(actions.filter((a) => a === "AUCTION_WINNER_SELECTED")).toHaveLength(1);
  }, 90_000);

  it("deduplicates: enqueueing the same step twice yields one job id", async () => {
    await queue.add("FINALIZE_AUCTION", { groupId: "g", cycleId: "c", expectedClosingVersion: 1 }, { jobId: "FINALIZE_AUCTION-dup", delay: 60_000 });
    await queue.add("FINALIZE_AUCTION", { groupId: "g", cycleId: "c", expectedClosingVersion: 1 }, { jobId: "FINALIZE_AUCTION-dup", delay: 60_000 });
    expect((await queue.getDelayed()).filter((j) => j.id === "FINALIZE_AUCTION-dup")).toHaveLength(1);
  });
});
