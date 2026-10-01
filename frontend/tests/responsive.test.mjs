// Structural guards for the responsive layer (no browser needed): one breakpoint set, no overflow-prone patterns,
// touch-friendly primitives, and phone navigation limited to four destinations plus "More".
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const css = read("packages/ui/src/globals.css");
const sources = () => {
  const files = [];
  const walk = (d) => readdirSync(root + d, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) { if (e.name !== "node_modules") walk(d + e.name + "/"); } else if (/\.(tsx?|css)$/.test(e.name)) files.push(d + e.name); });
  walk("packages/"); walk("apps/");
  return files;
};

test("one breakpoint set: every width media query uses a documented breakpoint", () => {
  const allowed = new Set(["359", "419", "479", "639", "640", "767", "768", "899", "1023", "1024", "1279", "1280"]);
  const widths = [...css.matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 20, "media queries exist");
  const unexpected = [...new Set(widths)].filter((w) => !allowed.has(w));
  assert.deepEqual(unexpected, [], `undocumented breakpoints: ${unexpected.join(", ")}`);
  // Feature components never carry their own media queries; responsive behaviour lives in the design system.
  for (const f of sources().filter((p) => p.endsWith(".tsx"))) assert.ok(!/@media/.test(read(f)), `${f}: component-level media query`);
});

test("no auto-fill/auto-fit grid can force a track wider than its container (the 320px overflow trap)", () => {
  for (const m of css.matchAll(/repeat\((?:auto-fill|auto-fit),\s*minmax\(([^,]+),/g)) assert.match(m[1], /^min\(/, `minmax(${m[1]}, …) must use min(Npx, 100%)`);
});

test("phone inputs are 16px (no iOS focus zoom) and controls reach 44px touch targets", () => {
  assert.match(css, /@media \(max-width: 767px\) \{ \.input, \.select, \.textarea \{ font-size: 16px; min-height: var\(--touch-target\); \}/);
  assert.match(css, /--touch-target: 44px/);
  assert.match(css, /\(hover: none\) and \(pointer: coarse\)/, "touch adjustments are keyed on coarse pointers");
  assert.match(css, /\.mobile-nav__link \{[^}]*min-height: var\(--touch-target\)/);
});

test("dialogs become bottom sheets that fit the viewport with internal scrolling and safe-area padding", () => {
  assert.match(css, /\.dialog \{[^}]*max-height: calc\(100dvh - 2rem\)[^}]*display: flex; flex-direction: column; overflow: hidden/);
  assert.match(css, /\.dialog__body \{[^}]*overflow: auto/);
  assert.match(css, /\.dialog__footer \{ padding-bottom: calc\(var\(--space-4\) \+ var\(--safe-bottom\)\); flex-direction: column; \}/);
  assert.match(css, /--safe-bottom: env\(safe-area-inset-bottom, 0px\)/);
  for (const bar of [".auc__sticky", ".wf-sticky", ".mobile-nav"]) assert.match(css, new RegExp(`${bar.replace(".", "\\.")} \\{[^}]*var\\(--safe-bottom\\)`), `${bar} respects the safe area`);
});

test("tables: card mode orders primary first and actions last; scroll mode pins the primary column and sets a minimum width", () => {
  assert.match(css, /\.table--responsive td\.cell--primary \{ order: -1;/);
  assert.match(css, /\.table--responsive td\.cell--actions \{ order: 99;/);
  assert.match(css, /\.table--responsive td\.cell--mobile-hidden \{ display: none; \}/);
  assert.match(css, /\.table--scroll \{ min-width: var\(--table-min-width, 720px\); \}/);
  assert.match(css, /\.table--sticky-first td\.cell--primary[^}]*position: sticky; left: 0/);
  const table = read("packages/ui/src/data-table.tsx");
  assert.match(table, /mobile\?: "hidden" \| "emphasis" \| "status"/);
  assert.match(table, /table--sticky-first/);
  // Member-facing money lists declare their phone card treatment; the dense admin table scrolls with a readable minimum width.
  assert.match(read("packages/features/src/contributions/my-contributions.tsx"), /mobile: "emphasis"/);
  assert.match(read("packages/features/src/payouts/payout-pages.tsx"), /mobile: "emphasis"/);
  assert.match(read("packages/features/src/admin/admin-groups.tsx"), /responsive=\{false\} minWidth=\{1180\}/);
});

test("phone navigation: at most four destinations plus More in both apps; admin filters collapse into a sheet", () => {
  assert.match(read("packages/features/src/layout/mobile-nav.tsx"), /\.slice\(0, 4\)/);
  assert.match(read("packages/features/src/layout/mobile-nav.tsx"), /aria-label="More navigation"/);
  const user = read("apps/user-web/src/shell/user-app.tsx");
  const fn = user.slice(user.indexOf("function mobileNavigation"), user.indexOf("function menuItems"));
  for (const block of fn.split("return [").slice(1)) assert.ok((block.split("href:").length - 1) <= 4, "≤ 4 bottom-nav items per role");
  assert.match(read("packages/features/src/layout/sidebar.tsx"), /sidebar__close/, "the phone drawer has a close button");
  for (const f of ["packages/features/src/admin/admin-groups.tsx", "packages/features/src/payouts/payout-pages.tsx", "packages/features/src/ledger/ledger-pages.tsx"]) assert.match(read(f), /<ResponsiveFilters/, `${f} uses ResponsiveFilters`);
  assert.match(read("packages/ui/src/responsive-filters.tsx"), /useIsPhone\(\)/, "fields render once per breakpoint (no duplicate ids)");
});

test("auction: quick bids wrap, custom bid uses the numeric keyboard, review is the only path to the confirm dialog", () => {
  assert.match(css, /\.auc__quick \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(96px, 100%\), 1fr\)\)/);
  const bid = read("packages/features/src/auctions/bid-panel.tsx");
  assert.match(bid, /inputMode="numeric"/);
  assert.match(bid, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); if \(amount !== null && !busy\) setReviewing\(true\); \}/, "Enter never submits a bid");
  assert.match(bid, /<BidSticky amount=\{amount\} onReview=/, "sticky bar only opens the review");
  assert.match(css, /\.auc__big \{[^}]*min-height: 1\.05em/, "the headline figure reserves its height so live updates do not shift layout");
});

test("no fixed pixel widths that cannot fit a 320px phone in component inline styles", () => {
  for (const f of sources().filter((p) => p.endsWith(".tsx"))) {
    const s = read(f);
    for (const m of s.matchAll(/(?:^|[^a-zA-Z])(?:width|minWidth):\s*(\d+)(?![\d.%])/g)) assert.ok(Number(m[1]) <= 288, `${f}: inline width ${m[1]}px exceeds a 320px phone's content box`);
  }
});
