import { createHash, randomBytes } from "node:crypto";
import { BusinessRuleError, requireRule } from "../../utils/errors.js";

/**
 * DHANVI_RANDOM_V1 — immutable historical specification, ported byte-for-byte from RandomDrawV1.cs and
 * cross-checked against tools/verify-random-draw.py. Any change to these bytes or the index mapping requires a
 * NEW algorithm version. Entropy comes only from crypto.randomBytes (never Math.random) and is committed
 * (SHA-256 of the seed) and revealed in the immutable SelectionResult.
 */
export const RANDOM_ALGORITHM_VERSION = "DHANVI_RANDOM_V1";
export const RANDOM_SOURCE_TYPE = "NODE_CRYPTO_RANDOM_BYTES";

export interface EligibleMember { membershipId: string; slotNumber: number }
export interface RandomDrawProof {
  algorithmVersion: string; groupId: string; cycleId: string; cycleNumber: number; canonicalEligibleMembers: EligibleMember[];
  eligibleSetHash: string; seedCommitment: string; seedReveal: string; selectedIndex: number; winnerMembershipId: string; resultHash: string;
}

const EMPTY = "00000000-0000-0000-0000-000000000000";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (value: string) => {
  const v = value.toLowerCase();
  if (!GUID.test(v)) throw new TypeError("Invalid GUID");
  return v;
};

export const sha256Hex = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/** Secure 32-byte seed (ISecureRandomSource). */
export const createSeed = (): Buffer => randomBytes(32);

export function canonicalMembers(members: Iterable<EligibleMember>): EligibleMember[] {
  const ordered = [...members].map((m) => ({ membershipId: id(m.membershipId), slotNumber: m.slotNumber })).sort((a, b) => a.slotNumber - b.slotNumber);
  requireRule(ordered.length >= 1 && ordered.length <= 50, "NO_ELIGIBLE_MEMBERS", "The eligible set must contain between one and fifty memberships.");
  requireRule(ordered.every((m) => m.membershipId !== EMPTY && Number.isInteger(m.slotNumber) && m.slotNumber >= 1 && m.slotNumber <= 50) &&
    new Set(ordered.map((m) => m.membershipId)).size === ordered.length && new Set(ordered.map((m) => m.slotNumber)).size === ordered.length,
    "INVALID_ELIGIBLE_SET", "Eligible memberships must have unique IDs and valid unique slots.");
  return ordered;
}

export function canonicalPayload(groupId: string, cycleId: string, number: number, members: Iterable<EligibleMember>): string {
  requireRule(id(groupId) !== EMPTY && id(cycleId) !== EMPTY && Number.isInteger(number) && number >= 1 && number <= 50, "INVALID_DRAW_IDENTIFIERS", "Valid group, cycle, and cycle number are required.");
  return `${RANDOM_ALGORITHM_VERSION}\n${id(groupId)}\n${id(cycleId)}\n${number}\n` + canonicalMembers(members).map((m) => `${m.membershipId}:${m.slotNumber}`).join("\n") + "\n";
}

/** Rejects the first 2^64 mod count candidates; the remaining range divides evenly by count (no modulo bias). */
export function tryMap(candidate: bigint, count: number): number | null {
  requireRule(count >= 1 && count <= 50, "INVALID_ELIGIBLE_SET", "Invalid eligible count.");
  const bound = BigInt(count);
  const threshold = (1n << 64n) % bound;
  return candidate < threshold ? null : Number(candidate % bound);
}

export function selectIndex(seed: Buffer, groupId: string, cycleId: string, number: number, eligibleSetHash: string, count: number): number {
  requireRule(seed.length === 32 && count >= 1 && count <= 50, "INVALID_DRAW_INPUT", "Invalid seed or eligible count.");
  for (let counter = 0n; ; counter++) {
    const context = Buffer.from(`${RANDOM_ALGORITHM_VERSION}\n${id(groupId)}\n${id(cycleId)}\n${number}\n${eligibleSetHash}\n${counter}\n`, "utf8");
    const digest = createHash("sha256").update(Buffer.concat([seed, context])).digest();
    const index = tryMap(digest.readBigUInt64BE(0), count);
    if (index !== null) return index;
    if (counter === (1n << 64n) - 1n) throw new BusinessRuleError("RANDOM_MAPPING_FAILED", "Random mapping exhausted its counter.");
  }
}

export const resultPayload = (groupId: string, cycleId: string, number: number, eligibleHash: string, commitment: string, reveal: string, index: number, winner: string): string =>
  `DHANVI_RANDOM_RESULT_V1\n${RANDOM_ALGORITHM_VERSION}\n${id(groupId)}\n${id(cycleId)}\n${number}\n${eligibleHash}\n${commitment}\n${reveal}\n${index}\n${id(winner)}\n`;

export function draw(groupId: string, cycleId: string, number: number, members: Iterable<EligibleMember>, seed: Buffer): RandomDrawProof {
  requireRule(seed.length === 32, "INVALID_RANDOM_SEED", "The seed must contain exactly 32 bytes.");
  const ordered = canonicalMembers(members);
  const eligibleSetHash = sha256Hex(Buffer.from(canonicalPayload(groupId, cycleId, number, ordered), "utf8"));
  const seedCommitment = sha256Hex(seed);
  const seedReveal = seed.toString("hex");
  const selectedIndex = selectIndex(seed, groupId, cycleId, number, eligibleSetHash, ordered.length);
  const winnerMembershipId = (ordered[selectedIndex] as EligibleMember).membershipId;
  const resultHash = sha256Hex(Buffer.from(resultPayload(groupId, cycleId, number, eligibleSetHash, seedCommitment, seedReveal, selectedIndex, winnerMembershipId), "utf8"));
  return { algorithmVersion: RANDOM_ALGORITHM_VERSION, groupId: id(groupId), cycleId: id(cycleId), cycleNumber: number, canonicalEligibleMembers: ordered,
    eligibleSetHash, seedCommitment, seedReveal, selectedIndex, winnerMembershipId, resultHash };
}

/** RandomDrawVerifier.Verify — recomputes everything from the revealed seed and the stored snapshot. */
export function verifyDraw(proof: RandomDrawProof): { valid: boolean; failureReason: string | null } {
  if (proof.algorithmVersion !== RANDOM_ALGORITHM_VERSION) return { valid: false, failureReason: "UNSUPPORTED_ALGORITHM_VERSION" };
  try {
    const ordered = canonicalMembers(proof.canonicalEligibleMembers);
    if (ordered.some((m, i) => m.membershipId !== proof.canonicalEligibleMembers[i]?.membershipId.toLowerCase() || m.slotNumber !== proof.canonicalEligibleMembers[i]?.slotNumber))
      return { valid: false, failureReason: "SNAPSHOT_NOT_CANONICAL" };
    if (!/^[0-9a-fA-F]*$/.test(proof.seedReveal) || proof.seedReveal.length % 2 !== 0) return { valid: false, failureReason: "INVALID_VERIFICATION_MATERIAL" };
    const calculated = draw(proof.groupId, proof.cycleId, proof.cycleNumber, ordered, Buffer.from(proof.seedReveal, "hex"));
    if (calculated.eligibleSetHash !== proof.eligibleSetHash) return { valid: false, failureReason: "ELIGIBLE_SET_HASH_MISMATCH" };
    if (calculated.seedCommitment !== proof.seedCommitment || calculated.seedReveal !== proof.seedReveal) return { valid: false, failureReason: "SEED_COMMITMENT_MISMATCH" };
    if (calculated.selectedIndex !== proof.selectedIndex || calculated.winnerMembershipId !== proof.winnerMembershipId.toLowerCase()) return { valid: false, failureReason: "WINNER_MISMATCH" };
    if (calculated.resultHash !== proof.resultHash) return { valid: false, failureReason: "RESULT_HASH_MISMATCH" };
    return { valid: true, failureReason: null };
  } catch {
    return { valid: false, failureReason: "INVALID_VERIFICATION_MATERIAL" };
  }
}

/** ORGANIZER_RESERVED_V1 result hash (cycle 1 reserved payout). */
export const reservedResultHash = (groupId: string, cycleId: string, organizer: EligibleMember): string =>
  sha256Hex(Buffer.from(["ORGANIZER_RESERVED_V1", id(groupId), id(cycleId), "1", id(organizer.membershipId), String(organizer.slotNumber)].join("\n") + "\n", "utf8"));

/** DHANVI_AUCTION_V1 selection result hash. */
export const auctionResultHash = (groupId: string, cycleId: string, number: number, winningBidId: string, winnerMembershipId: string): string =>
  sha256Hex(Buffer.from(["DHANVI_AUCTION_V1", id(groupId), id(cycleId), String(number), id(winningBidId), id(winnerMembershipId)].join("\n") + "\n", "utf8"));
