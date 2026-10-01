import type { RawEnv } from "./env.js";

export interface GroupMemberPolicy { minimumMembers: number; maximumMembers: number }

export const PRODUCTION_POLICY: GroupMemberPolicy = { minimumMembers: 20, maximumMembers: 50 };
export const DEVELOPMENT_POLICY: GroupMemberPolicy = { minimumMembers: 2, maximumMembers: 50 };

/** Port of GroupPolicyOptions.Resolve: development/test may go down to 2; everything else must stay 20–50. */
export function groupMemberPolicy(env: RawEnv): GroupMemberPolicy {
  const development = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const defaults = development ? DEVELOPMENT_POLICY : PRODUCTION_POLICY;
  const minimumMembers = env.GROUP_POLICY_MIN_MEMBERS ?? defaults.minimumMembers;
  const maximumMembers = env.GROUP_POLICY_MAX_MEMBERS ?? defaults.maximumMembers;
  if (!development && (minimumMembers !== PRODUCTION_POLICY.minimumMembers || maximumMembers !== PRODUCTION_POLICY.maximumMembers))
    throw new Error("Outside development/test, the group policy must remain 20–50 members.");
  if (minimumMembers < 2 || maximumMembers !== 50 || minimumMembers > maximumMembers)
    throw new Error("Group policy must stay within the database safe range of 2–50 members, with maximum 50.");
  return { minimumMembers, maximumMembers };
}
