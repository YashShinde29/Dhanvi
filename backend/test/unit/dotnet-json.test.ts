import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { netDateTimeOffset, netDecimal, netFingerprint, netInt, serializeNet } from "../../src/utils/dotnet-json.js";

// Every expected string/hash below was produced by .NET 10 System.Text.Json with default options
// (dotnet run golden.cs). They pin the byte format of fingerprints already stored in production rows.
const g = "8d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const h = "11111111-2222-4333-8444-555555555555";

describe("System.Text.Json default-options port", () => {
  it("escapes strings exactly like JavaScriptEncoder.Default", () => {
    const weird = "a\\b\nc\td\re\bf\fg/h`i\u007Fj😀k\u0001l m =;:!?#$%*()[]{}~|^@_-.,é";
    expect(serializeNet({ s: weird })).toBe(
      '{"s":"a\\\\b\\nc\\td\\re\\bf\\fg/h\\u0060i\\u007Fj\\uD83D\\uDE00k\\u0001l\\u2028m =;:!?#$%*()[]{}~|^@_-.,\\u00E9"}');
    expect(serializeNet({ f: "x<y&z'\"+é—" })).toBe('{"f":"x\\u003Cy\\u0026z\\u0027\\u0022\\u002B\\u00E9\\u2014"}');
  });

  it("formats DateTimeOffset with trimmed fractions and an unescaped +00:00 offset", () => {
    expect(serializeNet({ a: netDateTimeOffset("2026-01-02 03:04:05.000001+00"), b: netDateTimeOffset("2026-01-02T03:04:05.120Z") }))
      .toBe('{"a":"2026-01-02T03:04:05.000001+00:00","b":"2026-01-02T03:04:05.12+00:00"}');
    expect(serializeNet(netDateTimeOffset(new Date("2026-09-13T09:38:59.000Z")))).toBe('"2026-09-13T09:38:59+00:00"');
  });

  it("keeps decimal scale", () => {
    expect(serializeNet({ c: netDecimal("1.10"), d: netDecimal("-0.5"), e: netDecimal("100"), z: netDecimal("0") })).toBe('{"c":1.10,"d":-0.5,"e":100,"z":0}');
  });

  it("reproduces the ledger source fingerprint", () => {
    const source = {
      EventType: netInt(4), EventId: "0f8fad5b-d9cb-469f-a165-70867728950e", SourceModule: "Auctions",
      GroupId: "0f8fad5b-d9cb-469f-a165-70867728950e", CycleId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      WinnerMembershipId: "0f8fad5b-d9cb-469f-a165-70867728950e", SelectionResultId: "0f8fad5b-d9cb-469f-a165-70867728950e", AuctionResultId: null,
      GroupValue: netDecimal("50000.00"), WinnerPayout: netDecimal("45000.00"), PlatformFee: netDecimal("500.00"),
      Benefits: [{ MembershipId: "0f8fad5b-d9cb-469f-a165-70867728950e", Amount: netDecimal("500.00") }],
      TimeZone: "Asia/Kolkata", OccurredAt: netDateTimeOffset("2026-09-13 09:38:59.123456+00"), Fingerprint: "",
    };
    expect(netFingerprint(source)).toBe("525460f5913ced80b713d6c7560f6e263efaf2524be6fb29010aeb44f7cc64cb");
  });

  it("reproduces captured-payment, settled-payout and payout-event hashes", () => {
    expect(netFingerprint({
      PaymentId: g, ContributionId: h, GroupId: g, CycleId: h, MembershipId: g, UserId: h, Amount: netDecimal("2500.00"),
      TimeZone: "Asia/Kolkata", CapturedAt: netDateTimeOffset("2026-09-13 09:38:59.1+00"), ProviderPaymentId: "pay_TEST123",
    })).toBe("5b02da6c233dffbeca599f2d48764f3c8159c49a2604abad5d023a7e2ec2ba5a");
    expect(netFingerprint({
      Id: g, GroupId: h, CycleId: g, MembershipId: h, SelectionResultId: g, AuctionResultId: null, Amount: netDecimal("45000.00"), Benefit: false,
      TimeZone: "Asia/Kolkata", Actor: h, RequestedAt: netDateTimeOffset("2026-09-14T06:00:00.0000005Z"), MatchedSuccess: true, AllocationJournalId: g,
    })).toBe("06d20dd1e97d8173344a9220e14f84b51477a75e3af6b8fe9808d9ef8496d135");
    expect(netFingerprint({ Id: "fake_po_x", FundAccountId: "fake_fa_y", Amount: netDecimal("500.00"), Currency: "INR", Reference: "abc", Status: netInt(1), EventId: "fake_po_x:0" }))
      .toBe("9fbf22767187843de5e000a3144c75aaf48b3f12f929c9eb2702b835bbfac500");
    expect(netFingerprint(null)).toBe("74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b");
  });

  it("reproduces the contribution idempotency request hash (uppercase hex)", () => {
    const body = serializeNet({ groupId: g, cycleId: h, contributionId: g, UserId: h,
      record: { Amount: netDecimal("2500.5"), Reference: "UPI ref #1 + café", Note: "note" }, reversal: null });
    expect(createHash("sha256").update(body, "utf8").digest("hex").toUpperCase()).toBe("18F447377337B79AEF571D2BF1C2AD8F71DDD267B4AEEE393CC8D61B512B32BD");
  });
});
