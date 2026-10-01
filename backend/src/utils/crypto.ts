import { createHash, createHmac, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

export const newId = (): string => randomUUID();

export const sha256 = (data: string | Buffer): Buffer => createHash("sha256").update(data).digest();
/** Convert.ToHexString(SHA256.HashData(...)) — uppercase, as used for refresh/reset token hashes and contribution receipts. */
export const sha256HexUpper = (data: string | Buffer): string => sha256(data).toString("hex").toUpperCase();
/** Convert.ToHexStringLower(SHA256.HashData(...)) — lowercase, as used for bid/reschedule fingerprints and payload hashes. */
export const sha256HexLower = (data: string | Buffer): string => sha256(data).toString("hex");

/** TokenService.CreateOpaqueToken: 64 random bytes, base64url without padding. */
export const createOpaqueToken = (): string => randomBytes(64).toString("base64url");

/** RazorpaySignatures.Verify: hex HMAC-SHA256 compared in constant time over the exact bytes. */
export function verifyHmacSha256Hex(data: Buffer | string, signature: string, secret: string): boolean {
  if (!secret.trim() || signature.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(data).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/**
 * ASP.NET Core Identity PasswordHasher<TUser> (V3 format, .NET 8+ defaults) so existing hashes keep verifying:
 *   0x01 | PRF (uint32 BE: 0 SHA1, 1 SHA256, 2 SHA512) | iterations (uint32 BE) | salt length (uint32 BE) | salt | subkey
 * New hashes: PBKDF2-HMAC-SHA512, 100 000 iterations, 128-bit salt, 256-bit subkey. V2 (0x00, SHA1/1000) verifies with rehash.
 */
export type PasswordVerification = "FAILED" | "SUCCESS" | "SUCCESS_REHASH_NEEDED";
const ITERATIONS = 100_000;
const PRFS = ["sha1", "sha256", "sha512"] as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const subkey = await pbkdf2Async(password, salt, ITERATIONS, 32, "sha512");
  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(2, 1);
  header.writeUInt32BE(ITERATIONS, 5);
  header.writeUInt32BE(salt.length, 9);
  return Buffer.concat([header, salt, subkey]).toString("base64");
}

export async function verifyPassword(hashed: string, password: string): Promise<PasswordVerification> {
  let bytes: Buffer;
  try { bytes = Buffer.from(hashed, "base64"); } catch { return "FAILED"; }
  if (bytes.length === 0) return "FAILED";
  if (bytes[0] === 0x00) {
    if (bytes.length !== 1 + 16 + 32) return "FAILED";
    const actual = await pbkdf2Async(password, bytes.subarray(1, 17), 1000, 32, "sha1");
    return timingSafeEqual(actual, bytes.subarray(17)) ? "SUCCESS_REHASH_NEEDED" : "FAILED";
  }
  if (bytes[0] !== 0x01 || bytes.length < 13) return "FAILED";
  const prf = PRFS[bytes.readUInt32BE(1)];
  const iterations = bytes.readUInt32BE(5);
  const saltLength = bytes.readUInt32BE(9);
  if (!prf || saltLength < 16 || bytes.length < 13 + saltLength + 16) return "FAILED";
  const salt = bytes.subarray(13, 13 + saltLength);
  const expected = bytes.subarray(13 + saltLength);
  const actual = await pbkdf2Async(password, salt, iterations, expected.length, prf);
  if (!timingSafeEqual(actual, expected)) return "FAILED";
  return iterations < ITERATIONS || prf !== "sha512" ? "SUCCESS_REHASH_NEEDED" : "SUCCESS";
}
