// Pure auction-screen derivations: personal state, quick bids, validation, countdown, phases.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../packages/features/src/auctions/auction-model.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const context = { exports: {}, Intl, BigInt, Number, Math, String, Date };
vm.runInNewContext(compiled, context);
const m = context.exports;

const base = { id: "a", cycleNumber: 4, status: "OPEN", startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-02T23:59:00Z", serverTime: "2026-11-02T10:00:00Z", groupValue: 500000, groupName: "Dhanvi Growth Circle", durationMonths: 20,
  minimumDiscount: 25000, maximumDiscount: 200000, bidIncrement: 5000, currentHighestDiscount: 150000, minimumNextBid: 155000, potentialWinnerPayout: 350000, bidCount: 24, eligibleBidderCount: 17,
  canManage: false, canOpen: false, canClose: false, canBid: true, bidUnavailableReason: null, myBids: [], operationalBids: [], auditHistory: [], result: null, recentBids: [], currentLeaderSlot: 3 };

test("quick bids are minimum-next plus increments, capped at the maximum", () => {
  assert.deepEqual([...m.quickBids(base)], [155000, 160000, 165000]);
  assert.deepEqual([...m.quickBids({ ...base, currentHighestDiscount: 195000, minimumNextBid: 200000 })], [200000]);
  assert.deepEqual([...m.quickBids({ ...base, currentHighestDiscount: 200000, minimumNextBid: 205000 })], []);
  assert.equal(m.maximumReached({ ...base, currentHighestDiscount: 200000, minimumNextBid: 205000 }), true);
  assert.equal(m.maximumReached(base), false);
});

test("personal state follows the member's latest bid against the current highest", () => {
  assert.equal(m.personalState(base), "NOT_BID");
  assert.equal(m.personalState({ ...base, myBids: [{ bidId: "1", discountAmount: 140000, sequenceNumber: 20, isCurrentWinningBid: false, currentHighestDiscount: 150000, potentialWinnerPayout: 360000, submittedAt: "", memberSlot: null }] }), "OUTBID");
  assert.equal(m.personalState({ ...base, myBids: [{ bidId: "2", discountAmount: 150000, sequenceNumber: 24, isCurrentWinningBid: true, currentHighestDiscount: 150000, potentialWinnerPayout: 350000, submittedAt: "", memberSlot: null }] }), "LEADING");
  assert.equal(m.personalState({ ...base, canBid: false, bidUnavailableReason: "You already hold a main payout right." }), "INELIGIBLE");
  assert.equal(m.personalState({ ...base, status: "WINNER_SELECTED" }), "CLOSED");
  assert.equal(m.personalState({ ...base, status: "SCHEDULED" }), "SCHEDULED");
  assert.match(m.ineligibilityText("You already hold a main payout right."), /previous cycle/);
});

test("custom bid validation explains minimum, maximum, share divisibility and closed auctions", () => {
  assert.equal(m.validateBid(base, "155000"), null);
  assert.match(m.validateBid(base, "150000"), /Minimum next discount is ₹1,55,000/);
  assert.match(m.validateBid(base, "250000"), /Maximum allowed discount is ₹2,00,000/);
  assert.match(m.validateBid(base, "155000.01"), /divide exactly among all 20 members/);
  assert.match(m.validateBid({ ...base, status: "WINNER_SELECTED" }, "155000"), /already closed/);
  assert.match(m.validateBid(base, "abc"), /whole rupee/);
  assert.equal(m.validateBid(base, ""), null);
  assert.equal(m.projectedPayout(base, 155000), 345000);
});

test("countdown formats from the server clock and phases map from status", () => {
  assert.equal(m.countdown(4 * 60000 + 32000), "04:32");
  assert.equal(m.countdown(3600000 + 12 * 60000 + 34000), "01h 12m 34s");
  assert.equal(m.countdown(0), null);
  assert.equal(m.clockOffset("2026-11-02T10:00:00Z", Date.parse("2026-11-02T09:59:50Z")), 10000);
  for (const [status, phase] of [["SCHEDULED", "SCHEDULED"], ["OPEN", "LIVE"], ["CLOSED", "CLOSING"], ["WINNER_SELECTED", "COMPLETED"], ["CLOSED_NO_BIDS", "NO_BIDS"]]) assert.equal(m.screenPhase({ ...base, status }), phase);
});

test("auction screen files: dedicated route in every app, no auto-bidding, no 'best bid' wording, review before submit", () => {
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  for (const app of ["apps/user-web/src/app/groups/[id]/cycles/[cycleId]/auction/page.tsx", "apps/user-web/src/app/organizer/groups/[id]/cycles/[cycleId]/auction/page.tsx", "apps/admin-web/src/app/groups/[id]/cycles/[cycleId]/auction/page.tsx"]) assert.match(read(app), /AuctionPage/);
  const panel = read("packages/features/src/auctions/bid-panel.tsx"), exp = read("packages/features/src/auctions/auction-experience.tsx");
  assert.doesNotMatch(panel + exp, /Auto[ -]?bid|Proxy bid|Smart bid|Recommended bid|Best bid|Winning bid suggestion/i);
  assert.match(panel, /Review bid/); assert.match(panel, /Confirm your bid/); assert.match(panel, /Confirm & place bid/); assert.match(panel, /cannot be cancelled after it is accepted/);
  // The bid API has exactly one call site, inside the confirmation handler, after a fresh server read.
  const files = ["packages/features/src/auctions/bid-panel.tsx", "packages/features/src/auctions/auction-experience.tsx", "packages/features/src/auctions/auction-summary-card.tsx", "packages/features/src/auctions/auction-operations.tsx", "packages/features/src/dashboard/user-dashboard.tsx", "packages/features/src/groups/member-group-detail.tsx"];
  const callers = files.filter((f) => /auctionService\.bid\(/.test(read(f)));
  assert.deepEqual(callers, ["packages/features/src/auctions/bid-panel.tsx"]);
  const placeBody = panel.slice(panel.indexOf("async function place()"), panel.indexOf("function onKey"));
  assert.ok(placeBody.indexOf("auctionService.get(") < placeBody.indexOf("auctionService.bid("), "latest state is re-read before the bid is sent");
  assert.match(placeBody, /amount < latest\.minimumNextBid/);
  assert.doesNotMatch(panel, /<form/); assert.doesNotMatch(panel, /onBlur=/);
  assert.match(panel, /e\.key === "Enter"[\s\S]*setReviewing\(true\)/, "Enter opens the review, never submits");
  assert.match(panel, /Placing bid/);
  assert.match(panel, /BID_INCREMENT_NOT_MET/, "stale bids are explained, not generic errors");
  assert.match(exp, /Current highest discount/); assert.match(exp, /Projected winner payout/); assert.doesNotMatch(exp, /Current price/i);
  assert.doesNotMatch(read("packages/features/src/auctions/use-live-auction.ts"), /signalr|EventSource/i);
  assert.match(read("packages/features/src/auctions/use-live-auction.ts"), /visibilitychange/);
});
