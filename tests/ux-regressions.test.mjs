// Regression guards for the dialog focus-loss bug and the workflow-guidance layer.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");

test("dialog focus trap never re-runs on ordinary re-renders (root cause of one-letter-at-a-time inputs)", () => {
  const src = read("packages/ui/src/dialog.tsx");
  const trap = src.slice(src.indexOf("function useFocusTrap("), src.indexOf("const noop"));
  assert.match(trap, /const onCloseRef = useRef\(onClose\)/, "onClose is read through a ref");
  assert.match(trap, /\}, \[open, ref\]\);\s*\}\s*$/, "the effect depends only on open/ref — never on the onClose closure");
  assert.doesNotMatch(trap, /\[open, ref, onClose\]/);
  assert.match(trap, /if \(!node\?\.contains\(document\.activeElement\)\)/, "React autoFocus inside the dialog is respected");
});

test("no focus() workaround per keystroke and no value-derived keys on inputs", () => {
  const files = [];
  const walk = (d) => readdirSync(root + d, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) { if (e.name !== "node_modules") walk(d + e.name + "/"); } else if (/\.(ts|tsx)$/.test(e.name)) files.push(d + e.name); });
  walk("packages/"); walk("apps/");
  for (const f of files) {
    const s = read(f);
    assert.ok(!/onChange=\{[^}]*\.focus\(\)/.test(s), `${f}: refocus-on-change workaround`);
    assert.ok(!/key=\{(Math\.random|Date\.now|JSON\.stringify)/.test(s), `${f}: unstable key`);
    assert.ok(!/<(Input|Textarea|MoneyInput|SearchInput)[^>]*key=\{[a-z]+\.value\}/.test(s), `${f}: key derived from input value`);
  }
});

test("workflow layer: reusable components, domain adapters, a central status catalog and the group control engine exist", () => {
  const dir = "packages/features/src/workflow/";
  for (const f of ["next-action-card.tsx", "workflow-stepper.tsx", "workflow-status-card.tsx", "workflow-status.ts", "priority-strip.tsx", "group-workflow.ts", "membership-workflow.ts", "cycle-workflow.ts", "payment-workflow.ts", "payout-workflow.ts", "organizer-workflow.ts", "auction-workflow.ts", "group-control.ts", "admin-operations.ts"]) read(dir + f);
  const guidance = read("packages/utils/src/status-guidance.ts");
  for (const value of ["READY_FOR_SELECTION", "PROVIDER_PENDING", "PENDING_BENEFICIARY", "RECONCILIATION_REQUIRED", "FULLY_SUBSCRIBED", "APPLIED", "CLOSED_NO_BIDS"]) assert.ok(guidance.includes(`${value}:`), `guidance for ${value}`);
  const control = read(dir + "group-control.ts");
  assert.match(control, /export function deriveGroupControl/, "one engine derives stage, blocker, responsible actor and the single primary action");
  for (const id of ["publish", "confirm-ready", "activate", "start-selection", "open-auction", "close-auction", "prepare-payouts", "review-payouts", "suspend", "cancel"]) assert.ok(control.includes(`"${id}"`), `control action ${id}`);
  assert.match(read(dir + "admin-operations.ts"), /export function groupHealth/, "admin health is a presentation-only derivation");
  assert.match(read(dir + "workflow-stepper.tsx"), /sr-only/, "stepper state is not colour-only");
});

test("major pages mount workflow guidance; dashboards lead with next actions", () => {
  assert.match(read("packages/features/src/groups/member-group-detail.tsx"), /eyebrow="Your status"/);
  assert.match(read("packages/features/src/groups/member-group-detail.tsx"), /StickyActionBar/);
  assert.match(read("packages/features/src/contributions/cycle-panel.tsx"), /cycleSummary\(/);
  assert.match(read("packages/features/src/auctions/auction-experience.tsx"), /useLiveAuction\(/);
  assert.match(read("packages/features/src/payments/payment-checkout.tsx"), /paymentGuidance\(/);
  assert.match(read("packages/features/src/payouts/payout-pages.tsx"), /payoutChecklist\(/);
  assert.match(read("packages/features/src/groups/group-control-panel.tsx"), /deriveGroupControl|GroupControlState/);
  const user = read("packages/features/src/dashboard/user-dashboard.tsx"), org = read("packages/features/src/dashboard/organizer-dashboard.tsx"), admin = read("packages/features/src/dashboard/admin-dashboard.tsx");
  assert.ok(user.indexOf("Your next actions") < user.indexOf("My groups"), "next actions come before the group list");
  assert.match(org, /Actions required/); assert.match(admin, /Requires your attention/);
  assert.match(admin, /adminService\.overview\(\)/, "the admin dashboard uses the aggregated read model, not per-group calls");
  assert.doesNotMatch(admin, /contributionService\.cycles/, "no N+1 cycle requests on the admin dashboard");
  assert.match(read("apps/user-web/src/app/(user)/organizer/application-status/page.tsx"), /organizerSummary\(/);
  assert.match(read("packages/features/src/groups/group-wizard.tsx"), /Continue group setup/);
});
