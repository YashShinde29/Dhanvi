// Auction rescheduling: group-time-zone conversions, confirm-only submission, one action location, member restrictions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const load = (p) => { const compiled = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; const context = { exports: {}, Intl, Number, Math, String, Date }; vm.runInNewContext(compiled, context); return context.exports; };
const zoned = load("packages/utils/src/zoned-time.ts");

test("group wall-clock time converts to the same UTC instant the backend stores, and back", () => {
  // 22 Sep 2026 7:00 PM IST = 13:30 UTC; IST has no DST so the round trip is exact.
  assert.equal(zoned.zonedToUtc("2026-09-22", "19:00", "Asia/Kolkata"), "2026-09-22T13:30:00.000Z");
  assert.equal(JSON.stringify(zoned.utcToZonedFields("2026-09-22T13:30:00Z", "Asia/Kolkata")), JSON.stringify({ date: "2026-09-22", time: "19:00" }));
  // Midnight edge: 12:15 AM IST on the 23rd is still the 22nd in UTC.
  assert.equal(zoned.zonedToUtc("2026-09-23", "00:15", "Asia/Kolkata"), "2026-09-22T18:45:00.000Z");
  // A DST zone resolves the offset at the target instant (New York: EDT in July, EST in January).
  assert.equal(zoned.zonedToUtc("2026-07-01", "09:00", "America/New_York"), "2026-07-01T13:00:00.000Z");
  assert.equal(zoned.zonedToUtc("2026-01-15", "09:00", "America/New_York"), "2026-01-15T14:00:00.000Z");
  assert.equal(zoned.zoneOffsetMinutes(new Date("2026-09-22T13:30:00Z"), "Asia/Kolkata"), 330);
  assert.equal(zoned.zonedToUtc("", "19:00", "Asia/Kolkata"), null);
  assert.match(zoned.timeZoneLabel("Asia/Kolkata"), /India Standard Time/);
});

test("the reschedule dialog never submits from the form: review first, confirm calls the API once with a key and the seen version", () => {
  const src = read("packages/features/src/auctions/auction-reschedule.tsx");
  assert.equal((src.match(/auctionService\.reschedule\(/g) ?? []).length, 1, "exactly one API call site");
  assert.match(src, /function review\(\) \{ setTouched\(true\); if \(valid\) setStep\("confirm"\); \}/, "Review only advances to the confirmation step");
  assert.match(src, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\); review\(\); \}\}/, "Enter in the form reviews, never submits");
  assert.match(src, /expectedScheduleVersion: a\.scheduleVersion/, "the version the operator saw travels with the command");
  assert.match(src, /crypto\.randomUUID\(\)/, "an idempotency key per payload");
  assert.match(src, /c === "AUCTION_SCHEDULE_CONFLICT"/, "conflicts are surfaced, not retried silently");
  assert.match(src, /zonedToUtc\(date, startTime, zone\)/, "inputs are read in the group's time zone, never the browser's");
  assert.match(src, /Reschedule auction<\/Button>/); assert.doesNotMatch(src, />Edit<\/Button>/, "no vague Edit button");
  assert.match(src, /reasonCode: code, reasonText: text\.trim\(\) \|\| null, memberMessage: message\.trim\(\) \|\| null/, "structured reason: code + internal text + member message");
  assert.match(src, /code === "OTHER" && text\.trim\(\)\.length < MIN_OTHER/, "OTHER requires an explanation");
  assert.match(src, /Members never see this/, "the internal explanation is labelled as internal");
  const status = read("packages/utils/src/status.ts");
  for (const code of ["PUBLIC_HOLIDAY", "TECHNICAL_ISSUE", "OPERATIONAL_ISSUE", "ORGANIZER_REQUEST", "INCORRECT_SCHEDULE", "MEMBER_AVAILABILITY", "EMERGENCY", "OTHER"]) assert.ok(status.includes(`"${code}"`), `reason code ${code}`);
});

test("one reschedule location for operators; members get a rescheduled notice and no controls", () => {
  const ops = read("packages/features/src/auctions/auction-operations.tsx");
  assert.equal((ops.match(/<AuctionScheduleCard/g) ?? []).length, 1, "the schedule card is rendered once on the operations screen");
  for (const f of ["packages/features/src/admin/admin-group-detail.tsx", "packages/features/src/admin/admin-groups.tsx", "packages/features/src/groups/group-control-panel.tsx", "packages/features/src/groups/organizer-group-detail.tsx", "packages/features/src/auctions/bid-panel.tsx", "packages/features/src/auctions/auction-experience.tsx"])
    assert.doesNotMatch(read(f), /RescheduleAuctionDialog|AuctionScheduleCard/, `${f} must not host a second reschedule control`);
  const exp = read("packages/features/src/auctions/auction-experience.tsx");
  assert.match(exp, /<RescheduledNotice auction=\{a\} zone=\{zone\} groupId=\{group\.id\} cycle=\{cycle\} \/>/, "members see the previous → new notice");
  assert.match(exp, /a\.wasRescheduled && phase === "SCHEDULED" && <span className="badge badge--warning">Rescheduled<\/span>/);
  assert.match(read("packages/features/src/dashboard/user-dashboard.tsx"), /a\.wasRescheduled \? "RESCHEDULED" : "scheduled"/, "dashboard card flags a rescheduled auction");
  const types = read("packages/types/src/auction.ts");
  for (const field of ["wasRescheduled", "lastRescheduledAt", "rescheduleCount", "originalStartsAt", "previousStartsAt", "previousEndsAt", "latestReasonCode", "latestMemberMessage", "canReschedule", "scheduleVersion"]) assert.ok(types.includes(`${field}:`), `Auction.${field}`);
  assert.ok(!/scheduleHistory:/.test(types.slice(types.indexOf("export interface Auction {"), types.indexOf("export type AuctionScheduleReason"))), "the auction read model carries no history list");
  const errors = read("packages/utils/src/errors.ts");
  for (const code of ["AUCTION_ALREADY_OPEN", "AUCTION_ALREADY_COMPLETED", "AUCTION_RESCHEDULE_NOT_ALLOWED", "AUCTION_NEW_START_IN_PAST", "AUCTION_INVALID_TIME_RANGE", "AUCTION_SCHEDULE_CONFLICT", "AUCTION_PERMISSION_DENIED", "AUCTION_RESCHEDULE_REASON_REQUIRED"]) assert.ok(errors.includes(`${code}:`), `friendly message for ${code}`);
});

test("summary first, detail on demand: history is a separate paged call, never part of overview screens", () => {
  const resched = read("packages/features/src/auctions/auction-reschedule.tsx");
  assert.match(resched, /HISTORY_PAGE = 5/, "the drawer pages five changes at a time");
  assert.match(resched, /auctionService\.scheduleHistory\(groupId, cycle\.id, next, HISTORY_PAGE\)/, "the drawer calls the per-auction history endpoint");
  assert.match(resched, /Load more/, "more history is loaded on demand");
  assert.match(resched, /viewer === "operator" && c\.reasonText/, "internal notes render for operators only");
  assert.match(resched, /viewer === "operator" && c\.changedByRole/, "actors render for operators only");
  assert.match(resched, /Cycle \{cycle\.cycleNumber\} · this auction only/, "the drawer is scoped to one auction");
  const svc = read("packages/api-client/src/auction.service.ts");
  assert.match(svc, /schedule-history\?page=\$\{page\}&pageSize=\$\{pageSize\}/); assert.match(svc, /auction-schedule-history\?\$\{q\}/);
  // Overview-level screens never fetch history.
  for (const f of ["packages/features/src/groups/member-group-detail.tsx", "packages/features/src/groups/organizer-group-detail.tsx", "packages/features/src/admin/admin-group-detail.tsx", "packages/features/src/dashboard/user-dashboard.tsx", "packages/features/src/dashboard/admin-dashboard.tsx", "packages/features/src/auctions/auction-summary-card.tsx", "packages/features/src/auctions/auction-experience.tsx", "packages/features/src/auctions/auction-operations.tsx"])
    assert.doesNotMatch(read(f), /scheduleHistory\(|groupScheduleHistory\(/, `${f} must not fetch schedule history`);
  // Cycle lists carry one compact auction cell per cycle, with the reschedule count — no change rows.
  assert.match(read("packages/features/src/contributions/cycle-progress.tsx"), /auctionRescheduleCount/);
  assert.match(read("packages/features/src/admin/admin-group-detail.tsx"), /c\.auctionRescheduleCount > 0 && <span className="cell__sub"><span className="badge badge--warning badge--plain">Rescheduled/);
  // Full history page: server-paged 20 per page with a cycle filter, mounted for admin and organizer.
  const page = read("packages/features/src/auctions/auction-schedule-history-page.tsx");
  assert.match(page, /PAGE_SIZE = 20/); assert.match(page, /groupScheduleHistory\(scope, id, \{ cycleId: cycleId \|\| undefined, page, pageSize: PAGE_SIZE \}\)/); assert.match(page, /id="history-cycle"/);
  assert.match(read("apps/admin-web/src/app/groups/[id]/auction-history/page.tsx"), /scope="admin"/);
  assert.match(read("apps/user-web/src/app/organizer/groups/[id]/auction-history/page.tsx"), /scope="organizer"/);
  assert.match(read("packages/features/src/admin/admin-group-detail.tsx"), /auction-history/); assert.match(read("packages/features/src/groups/organizer-group-detail.tsx"), /auction-history/);
});
