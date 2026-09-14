import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/env.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function policy(environment, minimum) {
  const context = { exports: {}, process: { env: { NODE_ENV: environment, NEXT_PUBLIC_MIN_GROUP_MEMBERS: minimum } } };
  vm.runInNewContext(compiled, context);
  return context.exports.env;
}

for (const environment of ["development", "test"]) {
  test(`${environment} configuration allows 2–50 members`, () => {
    const config = readFileSync(new URL(`../.env.${environment}`, import.meta.url), "utf8");
    const minimum = config.match(/^NEXT_PUBLIC_MIN_GROUP_MEMBERS=(\d+)$/m)[1];
    const limits = policy(environment, minimum);
    assert.equal(limits.minimumGroupMembers, 2);
    assert.equal(limits.maximumGroupMembers, 50);
  });
}
test("production always retains 20–50, even with a development override", () => {
  for (const minimum of [undefined, "2", "20"]) {
    const limits = policy("production", minimum);
    assert.equal(limits.minimumGroupMembers, 20);
    assert.equal(limits.maximumGroupMembers, 50);
  }
});
test("missing configuration defaults to production and invalid development values fail", () => {
  assert.equal(policy("development").minimumGroupMembers, 20);
  for (const minimum of ["1", "51", "2.5", "invalid"]) {
    assert.throws(() => policy("development", minimum), /NEXT_PUBLIC_MIN_GROUP_MEMBERS/);
  }
});
