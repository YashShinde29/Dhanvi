import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../packages/config/src/env.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function policy(environment, minimum, extra = {}) {
  const context = { exports: {}, process: { env: { NODE_ENV: environment, NEXT_PUBLIC_MIN_GROUP_MEMBERS: minimum, ...extra } } };
  vm.runInNewContext(compiled, context);
  return context.exports.env;
}

for (const app of ["user-web", "admin-web"]) {
  for (const environment of ["development", "test"]) {
    test(`${app} ${environment} configuration allows 2–50 members`, () => {
      const config = readFileSync(new URL(`../apps/${app}/.env.${environment}`, import.meta.url), "utf8");
      const minimum = config.match(/^NEXT_PUBLIC_MIN_GROUP_MEMBERS=(\d+)$/m)[1];
      const limits = policy(environment, minimum);
      assert.equal(limits.minimumGroupMembers, 2);
      assert.equal(limits.maximumGroupMembers, 50);
    });
  }
}
test("production defaults retain 20–50, even with a minimum override", () => {
  for (const minimum of [undefined, "2", "20"]) {
    const limits = policy("production", minimum);
    assert.equal(limits.minimumGroupMembers, 20);
    assert.equal(limits.maximumGroupMembers, 50);
  }
});
test("optimized local Docker builds allow 2 members with an explicit development policy", () => {
  const limits = policy("production", "2", { NEXT_PUBLIC_APP_ENV: "development" });
  assert.equal(limits.minimumGroupMembers, 2);
  assert.equal(limits.maximumGroupMembers, 50);
});

test("an explicit production policy retains 20 members", () => {
  assert.equal(policy("development", "2", { NEXT_PUBLIC_APP_ENV: "production" }).minimumGroupMembers, 20);
});

test("cross-app URLs default to the two development ports", () => {
  const config = policy("development", "2");
  assert.equal(config.userAppUrl, "http://localhost:3000");
  assert.equal(config.adminAppUrl, "http://localhost:3001");
  assert.equal(config.appKind, "user");
  assert.equal(policy("development", "2", { NEXT_PUBLIC_APP_KIND: "admin", NEXT_PUBLIC_ADMIN_URL: "https://admin.example/" }).adminAppUrl, "https://admin.example");
});
