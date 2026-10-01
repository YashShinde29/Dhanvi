import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyHmacSha256Hex, verifyPassword } from "../../src/utils/crypto.js";

describe("ASP.NET Identity V3 password hash compatibility", () => {
  // Produced by the .NET API (PasswordHasher<User>) for "Passw0rd!" during the migration audit.
  const dotnetHash = "AQAAAAIAAYagAAAAEIrAcPrq6zg2jhDs/yIszrhAZMxBbnagmwevO8AWn5cKrrmYWB6ZgOEZv2MVTOXxwg==";

  it("verifies hashes created by .NET", async () => {
    expect(await verifyPassword(dotnetHash, "Passw0rd!")).toBe("SUCCESS");
    expect(await verifyPassword(dotnetHash, "passw0rd!")).toBe("FAILED");
  });

  it("creates V3 hashes with the .NET header and verifies them", async () => {
    const hash = await hashPassword("Another#Secret9");
    const bytes = Buffer.from(hash, "base64");
    expect(bytes[0]).toBe(1);
    expect(bytes.readUInt32BE(1)).toBe(2);
    expect(bytes.readUInt32BE(5)).toBe(100_000);
    expect(bytes.readUInt32BE(9)).toBe(16);
    expect(bytes.length).toBe(13 + 16 + 32);
    expect(hash.startsWith("AQAAAAIAAYagAAAAE")).toBe(true);
    expect(await verifyPassword(hash, "Another#Secret9")).toBe("SUCCESS");
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("", "x")).toBe("FAILED");
    expect(await verifyPassword("AQ==", "x")).toBe("FAILED");
  });
});

describe("Razorpay HMAC verification", () => {
  it("accepts only the exact-bytes hex HMAC", () => {
    const body = Buffer.from('{"event":"payment.captured","payload":{}}');
    const signature = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyHmacSha256Hex(body, signature, "whsec")).toBe(true);
    expect(verifyHmacSha256Hex(Buffer.from('{"event": "payment.captured","payload":{}}'), signature, "whsec")).toBe(false);
    expect(verifyHmacSha256Hex(body, signature, "")).toBe(false);
    expect(verifyHmacSha256Hex(body, "zz", "whsec")).toBe(false);
  });
});
