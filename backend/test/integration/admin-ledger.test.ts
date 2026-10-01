import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeGroup, NOW, recordAll } from "../support/fixtures.js";
import { as, createHarness, expectOk, type Harness, registerUser } from "../support/harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness({ now: NOW }); });
afterAll(async () => { await h.close(); });

describe("admin control center read models", () => {
  it("overview, group operations list and summary reflect persisted state; admins only", async () => {
    const g = await activeGroup(h, { members: 2, groupValue: 20000 });
    await recordAll(h, g, g.cycles[0]!.id as string);
    const admin = g.owner; const api = as(h, admin);
    const overview = expectOk(await api("GET", "admin/operations/overview"));
    expect(overview.groups).toMatchObject({ active: expect.any(Number), platformCyclesReadyForSelection: { count: expect.any(Number) } });
    expect(overview.groups.platformCyclesReadyForSelection.count).toBeGreaterThanOrEqual(1);
    const page = expectOk(await api("GET", "admin/groups/operations?status=ACTIVE&cycleStatus=READY_FOR_SELECTION&pageSize=5"));
    const row = page.items.find((r: { id: string }) => r.id === g.groupId);
    expect(row).toMatchObject({ status: "ACTIVE", creatorType: "PLATFORM", activeMemberCount: 2, currentCycle: { status: "READY_FOR_SELECTION", settledMemberCount: 2 } });
    const summary = expectOk(await api("GET", `admin/groups/${g.groupId}/operations-summary`));
    expect(summary.cycles).toHaveLength(2);
    expect(summary.activity.length).toBeGreaterThan(0);
    expect((await api("GET", "admin/groups/operations?status=NOPE")).statusCode).toBe(400);
    expect((await as(h, g.members[0]!)("GET", "admin/operations/overview")).statusCode).toBe(403);
  });
});

describe("ledger queries", () => {
  it("lists the chart of accounts, validates filters and keeps the trial balance balanced", async () => {
    const admin = await registerUser(h, ["SUPER_ADMIN"]);
    const accounts = expectOk(await as(h, admin)("GET", "admin/ledger/accounts"));
    expect(accounts.map((a: { code: string }) => a.code)).toEqual(["1000", "1010", "1020", "1100", "1200", "2000", "2100", "2200", "2300", "4000"]);
    expect(accounts[0]).toMatchObject({ accountType: "ASSET", normalBalance: "DEBIT", isSystem: true });
    expect((await as(h, admin)("GET", "admin/ledger/journals?from=2026-10-10&to=2026-10-01")).json().code).toBe("INVALID_LEDGER_FILTER");
    expect((await as(h, admin)("GET", "admin/ledger/journals?eventType=NOPE")).statusCode).toBe(400);
    expect(expectOk(await as(h, admin)("GET", "admin/ledger/trial-balance")).balanced).toBe(true);
    expect((await as(h, admin)("GET", "admin/ledger/accounts/9999/balance")).statusCode).toBe(404);
    expect(expectOk(await as(h, admin)("GET", "admin/ledger/accounts/2000/balance")).code).toBe("2000");
  });
});
