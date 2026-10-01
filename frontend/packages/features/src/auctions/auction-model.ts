import type { Auction, AuctionBid, AuctionClosingState } from "@dhanvi/types";

/**
 * Pure derivations for the auction screen. Everything here is presentation: the backend stays authoritative for
 * window, increments, eligibility and acceptance. Amounts are handled in integer paise to avoid rounding drift.
 */
export type PersonalState = "LEADING" | "OUTBID" | "NOT_BID" | "INELIGIBLE" | "CLOSED" | "SCHEDULED";
export type ScreenPhase = "SCHEDULED" | "LIVE" | "CLOSING" | "COMPLETED" | "NO_BIDS";

export const paise = (value: number | string): bigint | null => {
  const text = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
};
export const rupees = (p: bigint): number => Number(p) / 100;

export function screenPhase(a: Auction): ScreenPhase {
  if (a.status === "SCHEDULED") return "SCHEDULED";
  // Going Once / Going Twice / Final Call still accept bids; only Finalizing stops bidding.
  if (a.status === "OPEN") return a.closingState === "FINALIZING" ? "CLOSING" : "LIVE";
  if (a.status === "CLOSED") return "CLOSING";
  if (a.status === "CLOSED_NO_BIDS") return "NO_BIDS";
  return "COMPLETED";
}

export function latestOwnBid(a: Auction): AuctionBid | undefined {
  return [...a.myBids].sort((x, y) => y.sequenceNumber - x.sequenceNumber)[0];
}

export function personalState(a: Auction): PersonalState {
  const phase = screenPhase(a);
  if (phase === "SCHEDULED") return "SCHEDULED";
  if (phase !== "LIVE") return "CLOSED";
  const own = latestOwnBid(a);
  if (own?.isCurrentWinningBid) return "LEADING";
  if (own) return "OUTBID";
  return a.canBid ? "NOT_BID" : "INELIGIBLE";
}

/** True once no valid higher bid exists (current highest + increment would exceed the maximum). */
export const maximumReached = (a: Auction) => a.bidCount > 0 && a.minimumNextBid > a.maximumDiscount;

/** Next valid options: minimum next, +1 increment, +2 increments — never above the maximum, never hard-coded. */
export function quickBids(a: Auction): number[] {
  const next = paise(a.minimumNextBid), inc = paise(a.bidIncrement), max = paise(a.maximumDiscount);
  if (next === null || inc === null || max === null || inc <= BigInt(0)) return [];
  const options: number[] = [];
  for (let i = 0; i < 3; i++) { const v = next + inc * BigInt(i); if (v <= max) options.push(rupees(v)); }
  return options;
}

export const projectedPayout = (a: Pick<Auction, "groupValue">, discount: number) => a.groupValue - discount;

/** Validation message for a custom discount, or null when it is a valid next bid. Mirrors the backend rules for immediate feedback only. */
export function validateBid(a: Auction, input: string): string | null {
  if (!input.trim()) return null;
  const value = paise(input);
  if (value === null) return "Enter a whole rupee amount (up to two decimals).";
  const next = paise(a.minimumNextBid)!, max = paise(a.maximumDiscount)!, groupValue = paise(a.groupValue)!;
  // Duration equals the member count (backend invariant); every bid must split into exact paise per member.
  const members = BigInt(Math.max(1, a.durationMonths));
  if (a.status !== "OPEN") return "This auction has already closed.";
  if (value < next) return `Minimum next discount is ${money(a.minimumNextBid)}.`;
  if (value > max) return `Maximum allowed discount is ${money(a.maximumDiscount)}.`;
  if (value >= groupValue) return "The discount must be less than the group value.";
  if (value % members !== BigInt(0)) return `Bids must divide exactly among all ${members} members (whole paise each).`;
  return null;
}

export function money(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Number.isInteger(value) ? 0 : 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}

/** Countdown text from the backend clock: "04:32" under an hour, "01h 12m 34s" above, null when elapsed. */
export function countdown(msRemaining: number): string | null {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return null;
  const total = Math.floor(msRemaining / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  // A day or more away (typical for a scheduled or rescheduled auction): "1d 04h" reads better than "28h 07m 35s".
  if (h >= 24) return `${Math.floor(h / 24)}d ${pad(h % 24)}h`;
  if (h > 0) return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}:${pad(s)}`;
}

/** Offset between the server clock and this device, taken from the last response, so the countdown never trusts the client clock alone. */
export const clockOffset = (serverTime: string, receivedAt: number) => new Date(serverTime).getTime() - receivedAt;

export const INELIGIBILITY: Record<string, string> = {
  ALREADY_SELECTED: "You already received your main payout in a previous cycle.", ALREADY_SELECTED_FOR_PAYOUT: "You already received your main payout in a previous cycle.",
  "You already hold a main payout right.": "You already received your main payout in a previous cycle.",
  "An active membership and fully recorded contribution are required.": "Your contribution for this cycle is not financially settled, or your membership is not active.",
  "Maximum discount has been reached.": "The maximum discount has been reached. No higher bid can be submitted.",
  "Outside the configured auction window.": "The auction window is closed right now.", "Auction is not open.": "The auction is not open right now.", "Group is not active.": "The group is not active.",
};
export const ineligibilityText = (reason: string | null) => (reason ? INELIGIBILITY[reason] ?? reason : "You cannot participate in this auction.");

/** Member-facing wording for the backend closing states; raw enum values are never shown. */
export const CLOSING_LABELS: Record<AuctionClosingState, string> = {
  GOING_ONCE: "Going Once", GOING_TWICE: "Going Twice", FINAL_WARNING: "Final Call", FINALIZING: "Finalizing...", COMPLETED: "Auction Completed",
};
export const closingLabel = (state: AuctionClosingState | null | undefined) => (state ? CLOSING_LABELS[state] : null);

/** True during the three bid-accepting closing phases. */
export const inClosingCall = (a: Pick<Auction, "status" | "closingState">) =>
  a.status === "OPEN" && (a.closingState === "GOING_ONCE" || a.closingState === "GOING_TWICE" || a.closingState === "FINAL_WARNING");

/**
 * Timer emphasis for the normal window: more than 10 minutes calm, 10–2 minutes amber, under 2 minutes strong.
 * Always paired with text (never colour alone).
 */
export type TimerTone = "normal" | "amber" | "urgent";
export function timerTone(msRemaining: number): TimerTone {
  if (msRemaining < 2 * 60_000) return "urgent";
  if (msRemaining <= 10 * 60_000) return "amber";
  return "normal";
}
export const TIMER_TONE_TEXT: Record<TimerTone, string | null> = { normal: null, amber: "Closing soon", urgent: "Final minutes" };
