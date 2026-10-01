import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSeed, draw, tryMap, verifyDraw } from "../../src/features/random-draw/random-draw.algorithm.js";

const verifier = fileURLToPath(new URL("../../../tools/verify-random-draw.py", import.meta.url));
const python = (proof: unknown) => JSON.parse(execFileSync("python3", [verifier, "-"], { input: JSON.stringify({ proof }) }).toString()) as { valid: boolean; winnerMembershipId: string };

describe("DHANVI_RANDOM_V1", () => {
  it("reproduces the published golden vector (docs/examples/random-v1-test-vector.json)", () => {
    const vector = JSON.parse(readFileSync(new URL("../../../docs/examples/random-v1-test-vector.json", import.meta.url), "utf8"));
    const proof = draw(vector.groupId, vector.cycleId, vector.cycleNumber, vector.canonicalEligibleMembers, Buffer.from(vector.seedReveal, "hex"));
    expect(proof).toEqual(vector);
    expect(verifyDraw(vector)).toEqual({ valid: true, failureReason: null });
  });

  it("produces proofs the independent Python verifier accepts", () => {
    for (let run = 0; run < 25; run++) {
      const count = 1 + (run % 50);
      const members = Array.from({ length: count }, (_, i) => ({ membershipId: randomUUID(), slotNumber: count - i }));
      const proof = draw(randomUUID(), randomUUID(), 1 + (run % 20), members, createSeed());
      expect(verifyDraw(proof)).toEqual({ valid: true, failureReason: null });
      const external = python(proof);
      expect(external.valid).toBe(true);
      expect(external.winnerMembershipId).toBe(proof.winnerMembershipId);
    }
  });

  it("is deterministic for a revealed seed and detects tampering", () => {
    const members = [{ membershipId: randomUUID(), slotNumber: 2 }, { membershipId: randomUUID(), slotNumber: 1 }, { membershipId: randomUUID(), slotNumber: 3 }];
    const seed = Buffer.alloc(32, 7);
    const a = draw("0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", 4, members, seed);
    const b = draw("0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", 4, members, seed);
    expect(a).toEqual(b);
    expect(a.canonicalEligibleMembers.map((m) => m.slotNumber)).toEqual([1, 2, 3]);
    expect(verifyDraw({ ...a, selectedIndex: (a.selectedIndex + 1) % 3 }).failureReason).toBe("WINNER_MISMATCH");
    expect(verifyDraw({ ...a, seedReveal: "00".repeat(32) }).failureReason).toBe("SEED_COMMITMENT_MISMATCH");
    expect(verifyDraw({ ...a, eligibleSetHash: "0".repeat(64) }).failureReason).toBe("ELIGIBLE_SET_HASH_MISMATCH");
    expect(verifyDraw({ ...a, canonicalEligibleMembers: [...a.canonicalEligibleMembers].reverse() }).failureReason).toBe("SNAPSHOT_NOT_CANONICAL");
    expect(verifyDraw({ ...a, algorithmVersion: "V2" }).failureReason).toBe("UNSUPPORTED_ALGORITHM_VERSION");
  });

  it("rejection-samples to avoid modulo bias", () => {
    const threshold = (1n << 64n) % 3n; // 1
    expect(tryMap(0n, 3)).toBeNull();
    expect(tryMap(threshold, 3)).toBe(Number(threshold % 3n));
    expect(tryMap((1n << 64n) - 1n, 1)).toBe(0);
  });
});
