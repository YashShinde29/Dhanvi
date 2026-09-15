// Structural checks for the member app (3000) / admin portal (3001) split.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}
const routes = (app) => walk(`apps/${app}/src/app`).filter((p) => p.endsWith("page.tsx")).map((p) => "/" + p.replace(`apps/${app}/src/app/`, "").replace(/\/?page\.tsx$/, "").replace(/\([^)]+\)\/?/g, "")).map((r) => r.replace(/\/$/, "") || "/");
const sources = (dir) => walk(dir).filter((p) => /\.(ts|tsx|mjs)$/.test(p)).map((p) => [p, read(p)]);

test("user app starts on 3000 and admin app on 3001", () => {
  assert.match(JSON.parse(read("apps/user-web/package.json")).scripts.dev, /next dev -p 3000$/);
  assert.match(JSON.parse(read("apps/admin-web/package.json")).scripts.dev, /next dev -p 3001$/);
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const name of ["dev", "dev:user", "dev:admin", "build:user", "build:admin"]) assert.ok(scripts[name], `root script ${name}`);
});

test("login pages exist in both apps and the admin portal has no registration", () => {
  const user = routes("user-web"), admin = routes("admin-web");
  assert.ok(user.includes("/login") && user.includes("/register") && user.includes("/forgot-password"));
  assert.ok(admin.includes("/login") && !admin.includes("/register"));
});

test("member, organizer and public routes live only in the user app", () => {
  const user = routes("user-web"), admin = routes("admin-web");
  for (const route of ["/", "/dashboard", "/groups", "/my-groups", "/contributions", "/payments", "/payouts", "/organizer", "/organizer/groups", "/become-organizer"]) assert.ok(user.includes(route), `user-web ${route}`);
  for (const route of ["/", "/contributions", "/my-groups", "/become-organizer"]) assert.ok(!admin.includes(route) || route === "/", `admin-web must not serve ${route}`);
  assert.ok(!admin.some((r) => r === "/organizer" || r.startsWith("/organizer/")), "organizer pages stay in the member app");
});

test("admin operational routes live only in the admin app, with clean URLs", () => {
  const user = routes("user-web"), admin = routes("admin-web");
  for (const route of ["/dashboard", "/organizers", "/groups", "/groups/create", "/payments", "/payments/[id]", "/payouts", "/payouts/[id]", "/ledger", "/ledger/trial-balance", "/ledger/journals/[id]"]) assert.ok(admin.includes(route), `admin-web ${route}`);
  assert.ok(!admin.some((r) => r.startsWith("/admin")), "admin app must not use /admin/admin URLs");
  assert.ok(!user.some((r) => r.startsWith("/admin")), "user app must not render admin screens");
  assert.match(read("apps/user-web/next.config.ts"), /source: "\/admin\/:path\*"/, "old /admin/* member URLs redirect to the admin portal");
});

test("Razorpay Checkout is mounted only in the user app", () => {
  const userSources = sources("apps/user-web/src"), adminSources = sources("apps/admin-web/src");
  assert.ok(userSources.some(([, s]) => s.includes("my-contributions")), "user app mounts the contributions page with checkout");
  assert.ok(!adminSources.some(([, s]) => /payment-checkout|my-contributions|contribution-card|checkout\.razorpay\.com/.test(s)), "admin app never imports the checkout");
  assert.ok(read("packages/features/src/payments/payment-checkout.tsx").includes("https://checkout.razorpay.com/v1/checkout.js"));
});

test("shells: no admin navigation in the member sidebar, no member navigation in the admin sidebar", () => {
  const userShell = read("apps/user-web/src/shell/user-app.tsx"), adminShell = read("apps/admin-web/src/shell/admin-app.tsx");
  for (const href of ['"/organizers"', '"/ledger/trial-balance"', '"/admin']) assert.ok(!userShell.includes(href), `member shell must not link ${href}`);
  assert.ok(userShell.includes("env.adminAppUrl"), "member shell cross-links administrators to the admin portal");
  for (const href of ['"/contributions"', '"/my-groups"', '"/organizer"', '"/become-organizer"']) assert.ok(!adminShell.includes(href), `admin shell must not link ${href}`);
  assert.ok(adminShell.includes("env.userAppUrl"), "admin shell cross-links to the member app");
});

test("route guards: each app declares its allowed roles and every page is protected", () => {
  assert.match(read("apps/admin-web/src/shell/admin-app.tsx"), /allowedRoles: ADMIN_ROLES/);
  assert.match(read("apps/user-web/src/shell/user-app.tsx"), /allowedRoles: USER_APP_ROLES/);
  const roles = read("packages/auth/src/roles.ts");
  assert.match(roles, /ADMIN_ROLES: PlatformRole\[\] = \["ADMIN", "SUPER_ADMIN"\]/);
  assert.match(roles, /USER_APP_ROLES: PlatformRole\[\] = \["USER", "ORGANIZER"\]/);
  const unguarded = walk("apps/admin-web/src/app").filter((p) => p.endsWith("page.tsx") && !/\/(login|page)\.tsx$/.test(p) && !/src\/app\/page\.tsx$/.test(p))
    .filter((p) => { const s = read(p); return !/ProtectedPage|AdminLedgerPage|JournalDetailsPage|TrialBalancePage|LedgerAccountsPage|PaymentsPage|PaymentDetailsPage|PayoutsPage|PayoutDetailsPage|GroupListPage|GroupCreatePage|GroupDetailPage|ManageContributionsPage|AuctionPage|OrganizerApplicationsQueue/.test(s); });
  assert.deepEqual(unguarded, []);
  assert.match(read("packages/features/src/auth/forbidden.tsx"), /Access restricted/);
  assert.match(read("apps/admin-web/src/shell/admin-app.tsx"), /You do not have permission to access the Dhanvi Admin Portal\./);
});

test("apps never import from each other's src; shared code comes from packages", () => {
  for (const app of ["user-web", "admin-web"]) for (const [file, s] of sources(`apps/${app}/src`)) {
    assert.ok(!/from "(\.\.\/)+(apps|frontend)\//.test(s) && !s.includes("apps/user-web") && !s.includes("apps/admin-web"), `${file} imports from another app`);
  }
  for (const [file, s] of sources("packages")) assert.ok(!s.includes("apps/"), `${file} must not depend on an app`);
});

test("shared API client is the only fetch implementation", () => {
  const client = read("packages/api-client/src/api-client.ts");
  assert.ok(client.includes('credentials: "include"'), "cookie session is sent by the shared client");
  assert.ok(client.includes('response.status === 401'), "shared client refreshes once on 401");
  const others = sources("packages").concat(sources("apps/user-web/src"), sources("apps/admin-web/src")).filter(([p, s]) => !p.endsWith("api-client.ts") && /\bfetch\(/.test(s));
  assert.deepEqual(others.map(([p]) => p), []);
});
