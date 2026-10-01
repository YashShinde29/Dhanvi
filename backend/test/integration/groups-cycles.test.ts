import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeGroup, NOW, recordAll } from "../support/fixtures.js";
import { as, createHarness, expectOk, type Harness, registerUser } from "../support/harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness({ now: NOW }); });
afterAll(async () => { await h.close(); });

describe("groups: four creator × mechanism combinations", () => {
  it.each([
    ["admin", "RANDOM"], ["admin", "AUCTION"], ["organizer", "RANDOM"], ["organizer", "AUCTION"],
  ] as const)("%s + %s activates with one cycle per member and every obligation", async (creator, groupType) => {
    const g = await activeGroup(h, { creator, groupType, members: 4, groupValue: 40000 });
    expect(g.group).toMatchObject({ status: "ACTIVE", creatorType: creator === "admin" ? "PLATFORM" : "ORGANIZER", groupType, monthlyContribution: 10000, durationMonths: 4, currentCycleNumber: 1 });
    expect(g.cycles).toHaveLength(4);
    expect(g.cycles.map((c) => c.contributionDueDate)).toEqual(["2026-10-05", "2026-11-05", "2026-12-05", "2027-01-05"]);
    expect(g.cycles.map((c) => c.status)).toEqual(["COLLECTING_CONTRIBUTIONS", "UPCOMING", "UPCOMING", "UPCOMING"]);
    expect(g.cycles[1]!.selectionMethod).toBe(groupType);
    const obligations = await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."Contributions" WHERE "GroupId" = $1`, [g.groupId]);
    expect(obligations.count).toBe(16);
    // Re-activation returns the persisted schedule; nothing is regenerated.
    expect(expectOk(await as(h, g.owner)("POST", `groups/${g.groupId}/activate`))).toHaveLength(4);
    expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM groups."MonthlyCycles" WHERE "GroupId" = $1`, [g.groupId])).count).toBe(4);
  });

  it("organizer first payout reserves cycle 1 for the organizer (ORGANIZER_RESERVED)", async () => {
    const g = await activeGroup(h, { creator: "organizer", groupType: "AUCTION", members: 3, groupValue: 30000, organizerFirstPayout: true,
      auction: { minimumDiscount: 300, maximumDiscount: 9000, bidIncrement: 300, auctionStartTime: "18:00:00", auctionEndTime: "18:30:00" } });
    expect(g.group.firstCycleSelectionMethod).toBe("ORGANIZER_RESERVED");
    expect(g.cycles.map((c) => c.selectionMethod)).toEqual(["ORGANIZER_RESERVED", "AUCTION", "AUCTION"]);
    await recordAll(h, g, g.cycles[0]!.id as string, "organizer");
    const result = expectOk(await as(h, g.owner)("POST", `groups/${g.groupId}/cycles/${g.cycles[0]!.id}/selection`));
    expect(result).toMatchObject({ selectionMethod: "ORGANIZER_RESERVED", algorithmVersion: "ORGANIZER_RESERVED_V1", winner: { slotNumber: 1 } });
  });

  it("enforces ownership: organizers manage only their own groups; members cannot manage", async () => {
    const g = await activeGroup(h, { creator: "organizer", members: 2 });
    const otherOrganizer = await registerUser(h, ["ORGANIZER"], "Other");
    const res = await as(h, otherOrganizer)("GET", `organizer/groups/${g.groupId}`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: "NOT_GROUP_OWNER", code: "NOT_GROUP_OWNER" });
    expect((await as(h, g.members[0]!)("GET", `organizer/groups/${g.groupId}`)).statusCode).toBe(403);
    expect((await as(h, g.members[0]!)("POST", `groups/${g.groupId}/activate`)).json().code).toBe("NOT_GROUP_OWNER");
  });

  it("validates rules with the same codes (precision, schedule, platform rules)", async () => {
    const admin = await registerUser(h, ["ADMIN"]);
    const base = { name: "X", description: "", groupType: "RANDOM", groupValue: 50000, memberLimit: 3, organizerParticipates: false, organizerFirstPayout: false,
      contributionDueDay: 5, selectionDay: 10, payoutDay: 15, startDate: "2026-11-01" };
    expect((await as(h, admin)("POST", "admin/groups", base)).json().code).toBe("INVALID_CONTRIBUTION_PRECISION");
    expect((await as(h, admin)("POST", "admin/groups", { ...base, memberLimit: 2, payoutDay: 29 })).json().code).toBe("INVALID_SCHEDULE");
    expect((await as(h, admin)("POST", "admin/groups", { ...base, memberLimit: 2, organizerParticipates: true })).json().code).toBe("INVALID_PLATFORM_RULES");
    expect((await as(h, admin)("POST", "admin/groups", { ...base, memberLimit: 2, startDate: "2026-09-30" })).json().code).toBe("INVALID_START_DATE");
    expect((await as(h, admin)("POST", "admin/groups", { ...base, memberLimit: 1 })).json().code).toBe("INVALID_MEMBER_LIMIT");
  });
});

describe("membership capacity under concurrency", () => {
  it("approving the final slot concurrently succeeds exactly once (row lock)", async () => {
    const admin = await registerUser(h, ["ADMIN"]);
    const g = expectOk(await as(h, admin)("POST", "admin/groups", { name: "Race", description: "", groupType: "RANDOM", groupValue: 20000, memberLimit: 2, organizerParticipates: false,
      organizerFirstPayout: false, contributionDueDay: 5, selectionDay: 10, payoutDay: 15, startDate: "2026-11-01" }));
    expectOk(await as(h, admin)("POST", `admin/groups/${g.id}/publish`), 204);
    const applicants = await Promise.all([1, 2, 3, 4].map((i) => registerUser(h, [], `Racer${i}`)));
    for (const a of applicants) expectOk(await as(h, a)("POST", `groups/${g.id}/applications`), 204);
    const apps = expectOk(await as(h, admin)("GET", `admin/groups/${g.id}/applications`)) as Array<{ id: string }>;
    const results = await Promise.all(apps.map((a) => as(h, admin)("POST", `admin/groups/${g.id}/applications/${a.id}/approve`)));
    expect(results.filter((r) => r.statusCode === 204)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 409).map((r) => r.json().code)).toEqual(expect.arrayContaining(["GROUP_NOT_JOINABLE"]));
    const row = await h.db.one<{ CurrentMemberCount: number; Status: string }>(`SELECT "CurrentMemberCount","Status" FROM groups."Groups" WHERE "Id" = $1`, [g.id]);
    expect(row).toEqual({ CurrentMemberCount: 2, Status: "FullySubscribed" });
    const slots = await h.db.query<{ SlotNumber: number }>(`SELECT "SlotNumber" FROM groups."GroupMemberships" WHERE "GroupId" = $1 AND "SlotNumber" IS NOT NULL ORDER BY 1`, [g.id]);
    expect(slots.map((s) => s.SlotNumber)).toEqual([1, 2]);
  });
});

describe("contributions are tracking, not payments", () => {
  it("records idempotently, prevents over-recording, reverses and reopens the cycle, and never posts a journal", async () => {
    const g = await activeGroup(h, { members: 2, groupValue: 20000 });
    const cycle = g.cycles[0]!.id as string;
    const api = as(h, g.owner);
    const rows = expectOk(await api("GET", `admin/groups/${g.groupId}/cycles/${cycle}/contributions`));
    const c = rows[0];
    const url = `admin/groups/${g.groupId}/cycles/${cycle}/contributions/${c.id}`;
    expect((await api("POST", `${url}/record`, '{"amount":4000.50,"reference":"UPI-1"}')).json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const first = expectOk(await api("POST", `${url}/record`, '{"amount":4000.50,"reference":"UPI-1"}', { "idempotency-key": "k1" }));
    expect(first).toMatchObject({ replayed: false, entry: { amount: 4000.5, entryType: "RECORD" } });
    const replay = expectOk(await api("POST", `${url}/record`, '{"amount":4000.50,"reference":"UPI-1"}', { "idempotency-key": "k1" }));
    expect(replay).toMatchObject({ replayed: true, entry: { id: first.entry.id } });
    expect((await api("POST", `${url}/record`, '{"amount":10,"reference":"UPI-1"}', { "idempotency-key": "k1" })).json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await api("POST", `${url}/record`, '{"amount":9999.50,"reference":"UPI-2"}', { "idempotency-key": "k2" })).json().code).toBe("CONTRIBUTION_OVER_RECORD");
    expect((await api("POST", `${url}/record`, '{"amount":1,"reference":"UPI-1"}', { "idempotency-key": "k3" })).json().code).toBe("REFERENCE_ALREADY_USED");
    // Exact decimal: 4000.50 + 5999.50 = 10000.00, no float drift.
    expectOk(await api("POST", `${url}/record`, '{"amount":5999.50,"reference":"UPI-3"}', { "idempotency-key": "k4" }));
    await recordAll(h, g, cycle);
    expect(expectOk(await api("GET", `groups/${g.groupId}/cycles/${cycle}`)).status).toBe("READY_FOR_SELECTION");
    expectOk(await api("POST", `${url}/reverse`, { entryId: first.entry.id, reason: "Wrong member" }, { "idempotency-key": "k5" }));
    expect(expectOk(await api("GET", `groups/${g.groupId}/cycles/${cycle}`)).status).toBe("COLLECTING_CONTRIBUTIONS");
    expect((await api("POST", `${url}/reverse`, { entryId: first.entry.id, reason: "again" }, { "idempotency-key": "k6" })).json().code).toBe("ENTRY_ALREADY_REVERSED");
    expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM ledger."JournalEntries"`)).count).toBe(0);
    const actions = (await h.db.query<{ Action: string }>(`SELECT "Action" FROM groups."GroupAuditEvents" WHERE "GroupId" = $1`, [g.groupId])).map((a) => a.Action);
    expect(actions).toEqual(expect.arrayContaining(["GROUP_ACTIVATED", "CONTRIBUTION_PARTIALLY_RECORDED", "CONTRIBUTION_RECORDED", "CYCLE_READY_FOR_SELECTION", "CONTRIBUTION_REVERSED", "CYCLE_REOPENED_AFTER_REVERSAL"]));
    // Contribution history is append-only at the database level.
    await expect(h.db.execute(`DELETE FROM groups."ContributionEntries" WHERE "Id" = $1`, [first.entry.id])).rejects.toThrow(/append-only/);
  });

  it("concurrent records against the same obligation cannot exceed the expected amount", async () => {
    const g = await activeGroup(h, { members: 2, groupValue: 20000 });
    const cycle = g.cycles[0]!.id as string;
    const c = expectOk(await as(h, g.owner)("GET", `admin/groups/${g.groupId}/cycles/${cycle}/contributions`))[0];
    const url = `admin/groups/${g.groupId}/cycles/${cycle}/contributions/${c.id}/record`;
    const results = await Promise.all([1, 2, 3].map((i) => as(h, g.owner)("POST", url, `{"amount":6000,"reference":"C-${i}"}`, { "idempotency-key": `c${i}` })));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect((await h.db.one<{ RecordedAmount: { toFixed(n: number): string } }>(`SELECT "RecordedAmount" FROM groups."Contributions" WHERE "Id" = $1`, [c.id])).RecordedAmount.toFixed(2)).toBe("6000.00");
  });
});

describe("random selection", () => {
  it("draws once, verifies with commitment/reveal, matches the independent Python verifier, and is immutable", async () => {
    const g = await activeGroup(h, { members: 3, groupValue: 30000 });
    const cycle = g.cycles[0]!.id as string;
    const url = `groups/${g.groupId}/cycles/${cycle}/selection`;
    expect((await as(h, g.owner)("POST", url)).json().code).toBe("CYCLE_NOT_READY_FOR_SELECTION");
    await recordAll(h, g, cycle);
    expect(expectOk(await as(h, g.owner)("GET", `${url}/preview`))).toEqual({ eligibleMemberCount: 3, algorithmVersion: "DHANVI_RANDOM_V1", selectionMethod: "RANDOM" });
    const [a, b] = await Promise.all([as(h, g.owner)("POST", url), as(h, g.owner)("POST", url)]);
    const ra = expectOk(a); const rb = expectOk(b);
    expect(ra.id).toBe(rb.id);
    expect((await as(h, g.members[0]!)("POST", url)).json().code).toBe("NOT_AUTHORIZED_TO_EXECUTE_SELECTION");
    const verification = expectOk(await as(h, g.members[1]!)("GET", `${url}/verify`));
    expect(verification.valid).toBe(true);
    const verifier = fileURLToPath(new URL("../../../tools/verify-random-draw.py", import.meta.url));
    const external = JSON.parse(execFileSync("python3", [verifier, "-"], { input: JSON.stringify(verification) }).toString());
    expect(external).toMatchObject({ valid: true, winnerMembershipId: ra.winner.membershipId });
    expect(expectOk(await as(h, g.owner)("GET", `groups/${g.groupId}/cycles/${cycle}`)).status).toBe("SELECTION_COMPLETED");
    await expect(h.db.execute(`UPDATE groups."SelectionResults" SET "SelectedIndex" = 0 WHERE "Id" = $1`, [ra.id])).rejects.toThrow(/immutable/);
    // Manual collection: the selection is recorded but the ledger defers (no funded pool).
    expect((await h.db.one<{ count: number }>(`SELECT count(*)::int AS count FROM ledger."JournalEntries" WHERE "EventId" = $1`, [ra.id])).count).toBe(0);
  });
});
