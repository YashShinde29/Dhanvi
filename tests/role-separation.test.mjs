// Role boundaries and the one-action-one-button rule between the member portal (3000) and the admin control center (3001).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
function walk(dir) { return readdirSync(join(root, dir)).flatMap((name) => { const path = join(dir, name); return statSync(join(root, path)).isDirectory() ? walk(path) : [path]; }); }
const sources = (dir) => walk(dir).filter((p) => /\.(ts|tsx)$/.test(p)).map((p) => [p, read(p)]);
/** Every feature module an app reaches, transitively, through @dhanvi/features imports. */
function reach(app) {
  const seen = new Set(); const queue = sources(`apps/${app}/src`).map(([p]) => p);
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    const text = read(file);
    for (const m of text.matchAll(/from "([^"]+)"/g)) {
      const spec = m[1]; let target = null;
      if (spec.startsWith("@dhanvi/features/")) target = `packages/features/src/${spec.slice("@dhanvi/features/".length)}`;
      else if (spec.startsWith("./") || spec.startsWith("../")) { if (!file.startsWith("packages/features/")) continue; target = join(file, "..", spec); }
      else continue;
      for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) { queue.push(candidate); break; }
    }
  }
  return seen;
}

test("the member app never reaches admin-only screens and the admin app never reaches member participation screens", () => {
  const user = reach("user-web"), admin = reach("admin-web");
  for (const f of ["packages/features/src/admin/admin-groups.tsx", "packages/features/src/admin/admin-group-detail.tsx", "packages/features/src/admin/admin-reconciliation.tsx", "packages/features/src/dashboard/admin-dashboard.tsx", "packages/features/src/organizers/applications-queue.tsx"]) assert.ok(!user.has(f), `member app must not bundle ${f}`);
  for (const f of ["packages/features/src/dashboard/user-dashboard.tsx", "packages/features/src/dashboard/organizer-dashboard.tsx", "packages/features/src/contributions/my-contributions.tsx", "packages/features/src/payments/payment-checkout.tsx", "packages/features/src/groups/member-group-detail.tsx", "packages/features/src/groups/organizer-group-detail.tsx", "packages/features/src/groups/group-list.tsx", "packages/features/src/payouts/payout-account.tsx", "packages/features/src/marketing/landing-page.tsx"]) assert.ok(!admin.has(f), `admin app must not bundle ${f}`);
  assert.ok(admin.has("packages/features/src/admin/admin-group-detail.tsx") && user.has("packages/features/src/groups/member-group-detail.tsx"));
});

test("member-facing screens show no platform controls; admin screens show no member participation actions", () => {
  const memberScreens = ["packages/features/src/groups/member-group-detail.tsx", "packages/features/src/dashboard/user-dashboard.tsx", "packages/features/src/contributions/my-contributions.tsx", "packages/features/src/contributions/cycle-panel.tsx", "packages/features/src/payouts/cycle-settlement.tsx"];
  for (const f of memberScreens) { const s = read(f); for (const forbidden of ["Approve payout", "Execute payout", "Reconcile", "Force", "Platform ledger", "Approve organizer", "prepare-settlement", "payoutService.action(", "payoutService.prepare("]) assert.ok(!s.includes(forbidden), `${f} exposes "${forbidden}"`); }
  const adminScreens = ["packages/features/src/admin/admin-groups.tsx", "packages/features/src/admin/admin-group-detail.tsx", "packages/features/src/dashboard/admin-dashboard.tsx"];
  for (const f of adminScreens) { const s = read(f); for (const forbidden of ["Apply to join", "Pay now", "Place bid", "Accept rules", "Add bank account", "PaymentCheckout", "PayoutAccountForm"]) assert.ok(!s.includes(forbidden), `${f} exposes member action "${forbidden}"`); }
  // Members translate operational states into plain language.
  const member = read("packages/features/src/payouts/cycle-settlement.tsx") + read("packages/features/src/payouts/payout-pages.tsx");
  assert.match(member, /Your payout is delayed/);
});

test("one logical action has one home: lifecycle commands live only in the Group Control panel", () => {
  const allowed = new Set(["packages/features/src/groups/group-control-panel.tsx", "packages/features/src/groups/group-wizard.tsx", "packages/features/src/auctions/auction-operations.tsx"]);
  const commands = [/\/publish`/, /\/confirm-ready`/, /\/activate`/, /\/suspend`/, /\/cancel`/, /selectionService\.execute\(/, /auctionService\.manage\(/, /payoutService\.prepare\(/];
  for (const [file, s] of sources("packages/features/src")) {
    if (allowed.has(file)) continue;
    for (const command of commands) assert.ok(!command.test(s), `${file} issues a lifecycle command outside Group Control (${command})`);
  }
  assert.ok(!existsSync(join(root, "packages/features/src/groups/group-actions.tsx")), "the old scattered lifecycle action bar is gone");
  // Payout approve/execute/retry/reconcile only on the payout detail page; membership approve/reject only in the members table; organizer approve only in the queue.
  for (const [file, s] of sources("packages/features/src")) {
    if (file !== "packages/features/src/payouts/payout-pages.tsx") assert.ok(!/payoutService\.action\(/.test(s), `${file} runs payout commands`);
    if (file !== "packages/features/src/groups/group-members-table.tsx") assert.ok(!/applications\/\$\{[^}]+\}\/(approve|reject)/.test(s), `${file} approves/rejects memberships`);
    if (file !== "packages/features/src/organizers/applications-queue.tsx") assert.ok(!/organizerService\.(approve|reject)\(/.test(s), `${file} decides organizer applications`);
  }
});

test("tables use a single entry action and destructive actions sit in the overflow menu", () => {
  const groups = read("packages/features/src/admin/admin-groups.tsx");
  assert.equal((groups.match(/<LinkButton[^>]*>View<\/LinkButton>/g) ?? []).length, 1, "admin group rows expose exactly one View action");
  assert.doesNotMatch(groups, /Approve|Reject|Suspend|Cancel group/, "no inline lifecycle buttons in the admin group table");
  const control = read("packages/features/src/workflow/group-control.ts");
  assert.match(control, /\{ id: "suspend", label: "Suspend group", danger: true \}/); assert.match(control, /\{ id: "cancel", label: "Cancel group", danger: true \}/);
  assert.match(read("packages/ui/src/menu.tsx"), /menu__divider/, "danger items are separated from ordinary ones");
  const members = read("packages/features/src/groups/group-members-table.tsx");
  assert.equal((members.match(/onClick=\{\(\) => approve\(/g) ?? []).length, 1, "approve has one home (the review drawer)");
});

test("admin navigation only lists backend-supported modules and the backend exposes the admin read models", () => {
  const shell = read("apps/admin-web/src/shell/admin-app.tsx");
  for (const href of ['"/dashboard"', '"/groups"', '"/organizers"', '"/payments"', '"/payouts"', '"/reconciliation"', '"/ledger"']) assert.ok(shell.includes(href), `admin nav ${href}`);
  for (const href of ['"/users"', '"/audit"', '"/settings"']) assert.ok(!shell.includes(href), `admin nav must not link unsupported ${href}`);
  const endpoints = read("backend/src/Modules/Admin/Dhanvi.Modules.Admin.Api/AdminOperationsEndpoints.cs");
  assert.match(endpoints, /RequireAuthorization\("AdminOnly"\)/);
  for (const route of ['"/operations/overview"', '"/groups/operations"', '"/groups/{groupId:guid}/operations-summary"']) assert.ok(endpoints.includes(route), route);
  assert.doesNotMatch(endpoints, /MapPost|MapPut|MapDelete/, "read models expose no commands");
  const client = read("packages/api-client/src/admin.service.ts");
  for (const path of ["admin/operations/overview", "admin/groups/operations", "operations-summary"]) assert.ok(client.includes(path));
});

test("admin and member shells are visually distinct but share the brand", () => {
  assert.match(read("apps/admin-web/src/app/layout.tsx"), /data-app="admin"/);
  assert.match(read("apps/user-web/src/app/layout.tsx"), /data-app="user"/);
  const css = read("packages/ui/src/globals.css");
  assert.match(css, /\[data-app="admin"\] \.page/); assert.match(css, /--color-primary-700: #15803d/, "same Dhanvi brand tokens");
});
