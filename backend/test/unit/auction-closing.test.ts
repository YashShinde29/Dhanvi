import { describe, expect, it } from "vitest";
import type { AuctionConfig } from "../../src/config/auction.js";
import { advanceClosing, type Auction, calculate, effectiveClosing, endedWithoutBids, open, placeBid, scheduleAuction, winningBid } from "../../src/features/auction/auction.domain.js";
import { Decimal } from "../../src/utils/money.js";

const config: AuctionConfig = { automationEnabled: true, goingOnceSeconds: 30, goingTwiceSeconds: 30, finalWarningSeconds: 30, sweepIntervalSeconds: 15 };
const policy = { minimumMembers: 2, maximumMembers: 50 };
const t = (iso: string) => new Date(`2026-11-10T${iso}Z`);
const rules = { minimumDiscount: new Decimal(1000), maximumDiscount: new Decimal(20000), bidIncrement: new Decimal(500), auctionStartTime: "18:00:00", auctionEndTime: "18:30:00", feePolicy: "WinnerMemberShare" as const };

function openAuction(): Auction {
  const a = scheduleAuction("a1", "g1", "c1", 2, new Decimal(50000), 10, rules, t("18:00:00"), t("18:30:00"), t("17:00:00"), policy);
  open(a, t("18:00:00"));
  return a;
}
const bid = (a: Auction, amount: number, at: string, n = 1) => placeBid(a, `b${n}`, `m${n}`, new Decimal(amount), `k${n}`, t(at), config, policy);

describe("auction calculator", () => {
  it("splits ₹50,000 / ₹5,000 into a ₹45,000 winner payout and ₹500 shares", () => {
    const c = calculate(new Decimal(50000), 10, new Decimal(5000), "WinnerMemberShare", policy);
    expect(c.winnerPayout.toFixed(2)).toBe("45000.00");
    expect(c.grossMemberShare.toFixed(2)).toBe("500.00");
    expect(c.platformFee.toFixed(2)).toBe("500.00");
    expect(c.memberBenefitPool.toFixed(2)).toBe("4500.00");
    expect(() => calculate(new Decimal(50000), 10, new Decimal("5000.05"), "WinnerMemberShare", policy)).toThrow(/divided/);
  });
});

describe("digital closing sequence", () => {
  it("normal bids inside the window do not start a closing phase", () => {
    const a = openAuction();
    bid(a, 4000, "18:10:00");
    expect(a.closingPhase).toBeNull();
    expect(effectiveClosing(a, t("18:29:59"), config).state).toBeNull();
  });

  it("runs GOING_ONCE → GOING_TWICE → FINAL_WARNING → FINALIZING anchored to EndsAt", () => {
    const a = openAuction();
    bid(a, 4000, "18:10:00");
    expect(effectiveClosing(a, t("18:30:00"), config)).toMatchObject({ state: "GOING_ONCE", phaseEndsAt: t("18:30:30") });
    expect(advanceClosing(a, t("18:30:05"), config).map((x) => x.phase)).toEqual(["GOING_ONCE"]);
    expect(a.closingVersion).toBe(1);
    // A late worker materializes every due phase at once and lands exactly where the timeline says.
    expect(advanceClosing(a, t("18:31:31"), config).map((x) => x.phase)).toEqual(["GOING_TWICE", "FINAL_WARNING", "FINALIZING"]);
    expect(a.closingPhase).toBe("FINALIZING");
    expect(a.closingVersion).toBe(4);
  });

  it("a higher bid during Going Twice becomes highest and resets to GOING_ONCE", () => {
    const a = openAuction();
    bid(a, 4000, "18:10:00", 1);
    advanceClosing(a, t("18:30:40"), config);
    expect(a.closingPhase).toBe("GOING_TWICE");
    const { transitions } = bid(a, 5000, "18:30:45", 2);
    expect(transitions.at(-1)).toMatchObject({ kind: "RESET_BY_BID", from: "GOING_TWICE", phase: "GOING_ONCE" });
    expect(a.currentHighestDiscount.toFixed(2)).toBe("5000.00");
    expect(a.groupValue.minus(a.currentHighestDiscount).toFixed(2)).toBe("45000.00");
    expect(a.closingPhase).toBe("GOING_ONCE");
    expect(a.closingPhaseEndsAt).toEqual(t("18:31:15"));
  });

  it("accepts bids during Going Once and Final Call, rejects them once Finalizing", () => {
    const a = openAuction();
    bid(a, 4000, "18:10:00", 1);
    bid(a, 4500, "18:30:10", 2); // during GOING_ONCE (materialized by the bid itself)
    expect(a.closingPhase).toBe("GOING_ONCE");
    advanceClosing(a, t("18:31:30"), config); // 18:30:40 → twice, 18:31:10 → final warning (until 18:31:40)
    expect(a.closingPhase).toBe("FINAL_WARNING");
    bid(a, 5000, "18:31:35", 3);
    expect(a.closingPhase).toBe("GOING_ONCE");
    expect(() => bid(a, 5500, "18:33:20", 4)).toThrow(/finalized/);
  });

  it("a bid at the exact EndsAt boundary joins the closing sequence when a highest bid exists", () => {
    const a = openAuction();
    bid(a, 4000, "18:10:00", 1);
    bid(a, 4500, "18:30:00", 2);
    expect(a.closingPhase).toBe("GOING_ONCE");
    expect(a.closingPhaseEndsAt).toEqual(t("18:30:30"));
  });

  it("zero bids at EndsAt: no closing phase, bids rejected, auction ends without a winner", () => {
    const a = openAuction();
    expect(advanceClosing(a, t("18:30:00"), config)).toEqual([]);
    expect(endedWithoutBids(a, t("18:30:00"))).toBe(true);
    expect(() => bid(a, 4000, "18:30:00")).toThrow(/window/);
  });

  it("the winning bid is the highest discount", () => {
    const a = openAuction();
    const b1 = bid(a, 4000, "18:10:00", 1).bid; const b2 = bid(a, 5000, "18:11:00", 2).bid;
    expect(winningBid([b1, b2])?.id).toBe(b2.id);
    expect(() => bid(a, 5200, "18:12:00", 3)).toThrow(/increment/);
  });
});
