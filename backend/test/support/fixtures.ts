import { as, expectOk, type Harness, registerUser, type TestUser } from "./harness.js";

export const NOW = "2026-10-01T06:00:00Z";

export interface GroupOptions {
  members?: number; groupType?: "RANDOM" | "AUCTION"; creator?: "admin" | "organizer"; organizerFirstPayout?: boolean; collectionMode?: "MANUAL_TRACKING" | "RAZORPAY";
  groupValue?: number; auction?: { minimumDiscount: number; maximumDiscount: number; bidIncrement: number; auctionStartTime: string; auctionEndTime: string };
}

export interface ActiveGroup { owner: TestUser; members: TestUser[]; groupId: string; group: Record<string, unknown>; cycles: Array<Record<string, unknown>> }

/** Drives the real API from draft to ACTIVE: create → publish → apply → approve → accept terms → confirm ready → activate. */
export async function activeGroup(h: Harness, o: GroupOptions = {}): Promise<ActiveGroup> {
  const n = o.members ?? 2;
  const scope = o.creator ?? "admin";
  const owner = await registerUser(h, scope === "admin" ? ["ADMIN"] : ["ORGANIZER"], scope === "admin" ? "Admin" : "Organizer");
  const groupType = o.groupType ?? "RANDOM";
  const participates = scope === "organizer" && (o.organizerFirstPayout ?? false);
  const input = {
    name: `Test ${groupType} ${Date.now()}`, description: "Integration test group", groupType, groupValue: o.groupValue ?? 50000, memberLimit: n,
    organizerParticipates: participates, organizerFirstPayout: participates, contributionDueDay: 5, selectionDay: 10, payoutDay: 15, startDate: "2026-10-03",
    auctionRules: groupType === "AUCTION" ? (o.auction ?? { minimumDiscount: 1000, maximumDiscount: 20000, bidIncrement: 500, auctionStartTime: "18:00:00", auctionEndTime: "18:30:00" }) : null,
    ...(scope === "admin" ? { collectionMode: o.collectionMode ?? "MANUAL_TRACKING" } : {}),
  };
  const ownerApi = as(h, owner);
  const created = expectOk(await ownerApi("POST", `${scope}/groups`, input));
  const id = created.id as string;
  expectOk(await ownerApi("POST", `${scope}/groups/${id}/publish`), 204);
  const members: TestUser[] = [];
  if (participates) members.push(owner);
  while (members.length < n) {
    const m = await registerUser(h, [], `Member${members.length + 1}`);
    expectOk(await as(h, m)("POST", `groups/${id}/applications`), 204);
    members.push(m);
  }
  const apps = expectOk(await ownerApi("GET", `${scope}/groups/${id}/applications`)) as Array<{ id: string; status: string }>;
  for (const a of apps.filter((x) => x.status === "APPLIED")) expectOk(await ownerApi("POST", `${scope}/groups/${id}/applications/${a.id}/approve`), 204);
  const details = expectOk(await as(h, members[0]!)("GET", `groups/${id}`));
  for (const m of members) expectOk(await as(h, m)("POST", `groups/${id}/accept-terms`, { groupRuleVersionId: details.currentRules.id, rulesHash: details.currentRules.rulesHash }), 204);
  expectOk(await ownerApi("POST", `${scope}/groups/${id}/confirm-ready`), 204);
  const cycles = expectOk(await ownerApi("POST", `groups/${id}/activate`));
  return { owner, members, groupId: id, group: expectOk(await ownerApi("GET", `${scope}/groups/${id}`)), cycles };
}

/** Records every contribution of a cycle in full (manual tracking) so it becomes READY_FOR_SELECTION. */
export async function recordAll(h: Harness, g: ActiveGroup, cycleId: string, scope: "admin" | "organizer" = "admin") {
  const api = as(h, g.owner);
  const rows = expectOk(await api("GET", `${scope}/groups/${g.groupId}/cycles/${cycleId}/contributions`)) as Array<{ id: string; expectedAmount: number; recordedAmount: number }>;
  for (const c of rows) {
    if (c.recordedAmount >= c.expectedAmount) continue;
    expectOk(await api("POST", `${scope}/groups/${g.groupId}/cycles/${cycleId}/contributions/${c.id}/record`, `{"amount":${c.expectedAmount},"reference":"REF-${c.id.slice(0, 8)}"}`,
      { "idempotency-key": `rec-${c.id}` }));
  }
}
