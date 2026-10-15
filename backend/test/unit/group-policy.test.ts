import { describe, expect, it } from "vitest";
import type { RawEnv } from "../../src/config/env.js";
import { groupMemberPolicy, PRODUCTION_POLICY } from "../../src/config/groups.js";

describe("group member policy", () => {
  it.each(["production", "development", "test"] as const)("defaults to 2–50 in %s", (NODE_ENV) => {
    expect(groupMemberPolicy({ NODE_ENV } as RawEnv)).toEqual({ minimumMembers: 2, maximumMembers: 50 });
  });

  it("accepts an explicit two-member production minimum", () => {
    expect(groupMemberPolicy({ NODE_ENV: "production", GROUP_POLICY_MIN_MEMBERS: 2 } as RawEnv)).toEqual(PRODUCTION_POLICY);
  });

  it("rejects a stale production override with an actionable message", () => {
    expect(() => groupMemberPolicy({ NODE_ENV: "production", GROUP_POLICY_MIN_MEMBERS: 20 } as RawEnv)).toThrow("Set GROUP_POLICY_MIN_MEMBERS=2");
  });

  it.each([0, 1, 1.5, 2.5, 51])("rejects invalid minimum %s", (GROUP_POLICY_MIN_MEMBERS) => {
    expect(() => groupMemberPolicy({ NODE_ENV: "test", GROUP_POLICY_MIN_MEMBERS } as RawEnv)).toThrow();
  });
});
