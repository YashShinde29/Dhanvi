import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAuctionJob } from "../../src/workers/auction.worker.js";
import { activeGroup, type ActiveGroup, NOW, recordAll } from "../support/fixtures.js";
import { as, createHarness, expectOk, type Harness } from "../support/harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness({ now: NOW }); });
afterAll(async () => { await h.close(); });

/** Cycle 1 of an auction group: ₹50,000, 10 members, window 2026-10-10 18:00–18:30 UTC, ready for selection. */
async function readyAuction(members = 10): Promise<ActiveGroup & { cycleId: string; base: string }> {
  h.clock.set(NOW);
  const g = await activeGroup(h, { groupType: "AUCTION", members, groupValue: 50000,
    auction: { minimumDiscount: 1000, maximumDiscount: 20000, bidIncrement: 500, auctionStartTime: "18:00:00", auctionEndTime: "18:30:00" } });
  const cycleId = g.cycles[0]!.id as string;
  await recordAll(h, g, cycleId);
  return { ...g, cycleId, base: `groups/${g.groupId}/cycles/${cycleId}/auction` };
}
const at = (time: string) => h.clock.set(`2026-10-10T${time}Z`);
let keyCounter = 0;
const bid = (g: { base: string; members: ActiveGroup["members"] }, member: number, amount: string) =>
  as(h, g.members[member]!)("POST", `${g.base}/bids`, `{"discountAmount":${amount}}`, { "idempotency-key": `bid-${++keyCounter}` });
const job = async (g: { groupId: string; cycleId: string }, name: Parameters<typeof processAuctionJob>[1]) => {
  const next = await h.services.auctions.nextJob(g.groupId, g.cycleId);
  return processAuctionJob(h.services, name, { groupId: g.groupId, cycleId: g.cycleId, expectedClosingVersion: next?.expectedClosingVersion,
    expectedStartsAt: next?.expectedStartsAt, ...(next && "expectedHighestBidId" in next ? { expectedHighestBidId: next.expectedHighestBidId } : {}) }, "test-job");
};

describe("auction bidding", () => {
  it("opens only inside the window; bids are server-validated; two simultaneous equal bids accept exactly one", async () => {
    const g = await readyAuction();
    at("17:59:00");
    expect((await as(h, g.owner)("POST", `admin/${g.base}/open`)).json().code).toBe("AUCTION_OUTSIDE_WINDOW");
    at("18:00:00");
    const opened = expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    expect(opened).toMatchObject({ status: "OPEN", minimumNextBid: 1000, closingState: null });
    expect((await bid(g, 0, "900")).json().code).toBe("DISCOUNT_BELOW_MINIMUM");
    expect((await bid(g, 0, "25000")).json().code).toBe("DISCOUNT_ABOVE_MAXIMUM");
    expect((await bid(g, 0, "1000.05")).json().code).toBe("INVALID_AUCTION_ALLOCATION_PRECISION");
    at("18:05:00");
    const [a, b] = await Promise.all([bid(g, 0, "4000"), bid(g, 1, "4000")]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.json().code).toBe("BID_INCREMENT_NOT_MET");
    const view = expectOk(await as(h, g.members[2]!)("GET", g.base));
    expect(view).toMatchObject({ currentHighestDiscount: 4000, potentialWinnerPayout: 46000, minimumNextBid: 4500, bidCount: 1, canBid: true });
    // Bids are immutable history.
    await expect(h.db.execute(`UPDATE groups."AuctionBids" SET "DiscountAmount" = 1 WHERE "AuctionId" = $1`, [opened.id])).rejects.toThrow(/immutable/);
  });

  it("bid idempotency: same key replays the receipt; same key with another amount is rejected", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    const send = (amount: string) => as(h, g.members[0]!)("POST", `${g.base}/bids`, `{"discountAmount":${amount}}`, { "idempotency-key": "same-key" });
    const first = expectOk(await send("2000"));
    expect(expectOk(await send("2000.00")).bidId).toBe(first.bidId);
    expect((await send("2500")).json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."AuctionBids" WHERE "CycleId" = $1`, [g.cycleId])).count).toBe(1);
  });
});

describe("digital final call", () => {
  it("runs Going Once → Going Twice → Final Call → Finalizing → Completed and finalizes the ₹50,000 / ₹5,000 example", async () => {
    const g = await readyAuction();
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:10:00"); expectOk(await bid(g, 0, "4000"));
    at("18:29:59");
    expect(expectOk(await as(h, g.members[1]!)("GET", g.base)).closingState).toBeNull();
    at("18:30:00");
    expect(expectOk(await as(h, g.members[1]!)("GET", g.base))).toMatchObject({ status: "OPEN", closingState: "GOING_ONCE" });
    expect(await job(g, "START_CLOSING_SEQUENCE")).toMatchObject({ outcome: "APPLIED", actions: ["AUCTION_CLOSING_STARTED"] });
    at("18:30:40");
    expect(await job(g, "ADVANCE_GOING_ONCE")).toMatchObject({ outcome: "APPLIED", actions: ["AUCTION_CLOSING_GOING_TWICE"] });
    // Higher bid during Going Twice: ₹5,000 becomes highest and the sequence resets to Going Once.
    const reset = expectOk(await bid(g, 1, "5000"));
    expect(reset).toMatchObject({ discountAmount: 5000, potentialWinnerPayout: 45000 });
    const afterReset = expectOk(await as(h, g.members[2]!)("GET", g.base));
    expect(afterReset).toMatchObject({ closingState: "GOING_ONCE", currentHighestDiscount: 5000, potentialWinnerPayout: 45000 });
    expect(new Date(afterReset.closingPhaseEndsAt).toISOString()).toBe("2026-10-10T18:31:10.000Z");
    at("18:31:10"); await job(g, "ADVANCE_GOING_ONCE");
    at("18:31:40"); await job(g, "ADVANCE_GOING_TWICE");
    expect(expectOk(await as(h, g.members[2]!)("GET", g.base)).closingState).toBe("FINAL_WARNING");
    at("18:32:10");
    expect((await bid(g, 2, "5500")).json().code).toBe("AUCTION_CLOSED");
    const done = await job(g, "ADVANCE_FINAL_CALL");
    expect(done).toMatchObject({ outcome: "APPLIED" });
    expect((done as { actions: string[] }).actions).toEqual(expect.arrayContaining(["AUCTION_FINALIZING", "AUCTION_WINNER_SELECTED", "CYCLE_AUCTION_SELECTION_COMPLETED"]));
    const final = expectOk(await as(h, g.members[1]!)("GET", g.base));
    expect(final).toMatchObject({ status: "WINNER_SELECTED", closingState: "COMPLETED" });
    expect(final.result).toMatchObject({ winningDiscount: 5000, winnerPayout: 45000, grossMemberShare: 500, platformFee: 500, memberBenefitPool: 4500, nonWinnerCount: 9, myBenefitAllocation: 0 });
    expect(expectOk(await as(h, g.members[0]!)("GET", `${g.base}/result`)).myBenefitAllocation).toBe(500);
    const allocations = await h.db.query<{ AllocationType: string }>(`SELECT a."AllocationType" FROM groups."AuctionBenefitAllocations" a JOIN groups."AuctionResults" r ON r."Id" = a."AuctionResultId" WHERE r."CycleId" = $1`, [g.cycleId]);
    expect(allocations).toHaveLength(10);
    const cycle = expectOk(await as(h, g.owner)("GET", `groups/${g.groupId}/cycles/${g.cycleId}`));
    expect(cycle.status).toBe("SELECTION_COMPLETED");
  });

  it("bids during Going Once and Final Call reset; a bid at the exact EndsAt joins the sequence", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:10:00"); expectOk(await bid(g, 0, "2000"));
    at("18:30:00"); expectOk(await bid(g, 1, "2500")); // exact boundary, highest bid existed → Going Once
    expect(expectOk(await as(h, g.owner)("GET", `admin/groups/${g.groupId}/cycles/${g.cycleId}/auction`.replace("admin/", ""))).closingState).toBe("GOING_ONCE");
    at("18:30:20"); expectOk(await bid(g, 2, "3000")); // during Going Once
    at("18:31:20"); // 18:30:50 → twice, 18:31:20 → final warning
    expect(expectOk(await as(h, g.members[3]!)("GET", g.base)).closingState).toBe("FINAL_WARNING");
    expectOk(await bid(g, 3, "3500")); // during Final Call
    const view = expectOk(await as(h, g.members[0]!)("GET", g.base));
    expect(view).toMatchObject({ closingState: "GOING_ONCE", currentHighestDiscount: 3500 });
    const audit = (await h.db.query<{ Action: string }>(`SELECT "Action" FROM groups."GroupAuditEvents" WHERE "CycleId" = $1 ORDER BY "CreatedAt"`, [g.cycleId])).map((a) => a.Action);
    expect(audit.filter((a) => a === "AUCTION_CLOSING_RESET_BY_BID")).toHaveLength(3);
  });

  it("stale jobs no-op: the job's ClosingVersion and highest bid no longer match the database", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:10:00"); expectOk(await bid(g, 0, "2000"));
    at("18:30:05"); await job(g, "START_CLOSING_SEQUENCE");
    const scheduled = (await h.services.auctions.nextJob(g.groupId, g.cycleId))!; // ADVANCE_GOING_ONCE for version v
    expectOk(await bid(g, 1, "2500")); // reset → version v+1
    at("18:30:31");
    const stale = await processAuctionJob(h.services, "ADVANCE_GOING_ONCE", { groupId: g.groupId, cycleId: g.cycleId, expectedClosingVersion: scheduled.expectedClosingVersion }, "stale");
    expect(stale).toEqual({ outcome: "NOOP", reason: "STALE_CLOSING_VERSION" });
    expect(expectOk(await as(h, g.members[2]!)("GET", g.base)).closingState).toBe("GOING_ONCE");
    const wrongBid = await processAuctionJob(h.services, "FINALIZE_AUCTION", { groupId: g.groupId, cycleId: g.cycleId, expectedClosingVersion: scheduled.expectedClosingVersion! + 1, expectedHighestBidId: "00000000-0000-0000-0000-000000000000" }, "stale2");
    expect(wrongBid).toEqual({ outcome: "NOOP", reason: "STALE_HIGHEST_BID" });
  });

  it("duplicate finalization jobs produce exactly one winner, selection, allocation set and result", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:10:00"); expectOk(await bid(g, 0, "2000"));
    at("18:40:00");
    const next = (await h.services.auctions.nextJob(g.groupId, g.cycleId))!;
    const data = { groupId: g.groupId, cycleId: g.cycleId, expectedClosingVersion: next.expectedClosingVersion };
    const outcomes = await Promise.all([1, 2, 3].map((i) => processAuctionJob(h.services, "START_CLOSING_SEQUENCE", data, `dup-${i}`).catch((e: Error) => ({ outcome: "ERROR", reason: e.message }))));
    expect(outcomes.filter((o) => (o as { outcome: string }).outcome === "APPLIED")).toHaveLength(1);
    expect(outcomes.filter((o) => (o as { outcome: string }).outcome === "NOOP")).toHaveLength(2);
    for (const table of ["SelectionResults", "AuctionResults"])
      expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."${table}" WHERE "CycleId" = $1`, [g.cycleId])).count).toBe(1);
    const winners = await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "HasBeenSelectedForPayout"`, [g.groupId]);
    expect(winners.count).toBe(1);
    expect(await h.services.auctions.nextJob(g.groupId, g.cycleId)).toBeNull(); // nothing left to schedule
    expect(await job(g, "FINALIZE_AUCTION")).toEqual({ outcome: "NOOP", reason: "AUCTION_NOT_OPEN" });
  });

  it("zero bids at EndsAt keeps the existing behavior: closed with no winner", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:30:01");
    expect((await bid(g, 0, "2000")).json().code).toBe("AUCTION_OUTSIDE_WINDOW");
    expect(await job(g, "FINALIZE_AUCTION")).toMatchObject({ outcome: "APPLIED", actions: ["AUCTION_CLOSED", "AUCTION_CLOSED_NO_BIDS"] });
    expect(expectOk(await as(h, g.members[0]!)("GET", g.base))).toMatchObject({ status: "CLOSED_NO_BIDS", closingState: "COMPLETED" });
    expect((await as(h, g.members[0]!)("GET", `${g.base}/result`)).json().code).toBe("AUCTION_HAS_NO_BIDS");
  });

  it("OPEN_AUCTION opens automatically at StartsAt on behalf of the group owner", async () => {
    const g = await readyAuction(4);
    at("17:00:00");
    const next = (await h.services.auctions.nextJob(g.groupId, g.cycleId))!;
    expect(next).toMatchObject({ type: "OPEN_AUCTION", dueAt: new Date("2026-10-10T18:00:00Z") });
    expect(await job(g, "OPEN_AUCTION")).toEqual({ outcome: "NOOP", reason: "OUTSIDE_WINDOW" });
    at("18:00:00");
    expect(await job(g, "OPEN_AUCTION")).toMatchObject({ outcome: "APPLIED", actions: ["AUCTION_CREATED", "AUCTION_OPENED"] });
    expect(await job(g, "OPEN_AUCTION")).toMatchObject({ outcome: "NOOP" }); // duplicate delivery
    const actor = await h.db.one<{ ActorUserId: string }>(`SELECT "ActorUserId" FROM groups."GroupAuditEvents" WHERE "CycleId" = $1 AND "Action" = 'AUCTION_OPENED'`, [g.cycleId]);
    expect(actor.ActorUserId).toBe(g.owner.id);
  });

  it("manual close (operator) finalizes immediately, as before", async () => {
    const g = await readyAuction(4);
    at("18:00:00"); expectOk(await as(h, g.owner)("POST", `admin/${g.base}/open`));
    at("18:05:00"); expectOk(await bid(g, 0, "2000"));
    expect((await as(h, g.members[0]!)("POST", `admin/${g.base}/close`)).statusCode).toBe(403);
    const closed = expectOk(await as(h, g.owner)("POST", `admin/${g.base}/close`));
    expect(closed).toMatchObject({ status: "WINNER_SELECTED", result: { winningDiscount: 2000, winnerPayout: 48000 } });
    expect(expectOk(await as(h, g.owner)("POST", `admin/${g.base}/close`)).status).toBe("WINNER_SELECTED");
  });
});

describe("auction rescheduling", () => {
  it("requires a reason, is idempotent, keeps immutable history, and is blocked once open", async () => {
    const g = await readyAuction(4);
    at("12:00:00");
    const api = as(h, g.owner); const url = `admin/${g.base}/reschedule`;
    const body = { newStartsAt: "2026-10-11T18:00:00Z", newEndsAt: "2026-10-11T18:30:00Z", reasonCode: "PUBLIC_HOLIDAY", reasonText: "Diwali", memberMessage: "Moved by one day", expectedScheduleVersion: 0 };
    expect((await api("POST", url, { ...body, reasonCode: null }, { "idempotency-key": "r0" })).json().code).toBe("AUCTION_RESCHEDULE_REASON_REQUIRED");
    expect((await api("POST", url, { ...body, reasonCode: "OTHER", reasonText: "x" }, { "idempotency-key": "r0" })).json().code).toBe("AUCTION_RESCHEDULE_REASON_REQUIRED");
    expect((await as(h, g.members[0]!)("POST", url, body, { "idempotency-key": "r0" })).statusCode).toBe(403);
    const first = expectOk(await api("POST", url, body, { "idempotency-key": "r1" }));
    expect(first).toMatchObject({ status: "SCHEDULED", wasRescheduled: true, rescheduleCount: 1, latestReasonCode: "PUBLIC_HOLIDAY", latestMemberMessage: "Moved by one day", scheduleVersion: 1 });
    expect(expectOk(await api("POST", url, body, { "idempotency-key": "r1" })).rescheduleCount).toBe(1);
    expect((await api("POST", url, { ...body, newStartsAt: "2026-10-12T18:00:00Z", newEndsAt: "2026-10-12T18:30:00Z" }, { "idempotency-key": "r2" })).json().code).toBe("AUCTION_SCHEDULE_CONFLICT");
    const history = expectOk(await as(h, g.members[0]!)("GET", `${g.base}/schedule-history`));
    expect(history).toMatchObject({ totalCount: 1, items: [{ reasonCode: "PUBLIC_HOLIDAY", reasonText: null, changedByRole: null, changedByName: null, memberMessage: "Moved by one day" }] });
    const adminHistory = expectOk(await api("GET", `admin/groups/${g.groupId}/auction-schedule-history?page=1&pageSize=10`));
    expect(adminHistory.items[0]).toMatchObject({ reasonText: "Diwali", changedByRole: "ADMIN" });
    await expect(h.db.execute(`DELETE FROM groups."AuctionScheduleChanges" WHERE "GroupId" = $1`, [g.groupId])).rejects.toThrow(/immutable/);
    // The rescheduled window is authoritative for opening and for the cycle row.
    expect(expectOk(await api("GET", `groups/${g.groupId}/cycles/${g.cycleId}`))).toMatchObject({ auctionRescheduleCount: 1 });
    h.clock.set("2026-10-11T18:00:00Z");
    expectOk(await api("POST", `admin/${g.base}/open`));
    expect((await api("POST", url, { ...body, newStartsAt: "2026-10-12T18:00:00Z", newEndsAt: "2026-10-12T18:30:00Z", expectedScheduleVersion: null }, { "idempotency-key": "r3" })).json().code).toBe("AUCTION_ALREADY_OPEN");
  });
});
