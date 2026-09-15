/**
 * Shared display formatters. Every amount, date, and enum shown in the UI
 * should pass through one of these so the product reads consistently.
 */

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const wholeRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
const preciseRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const indianNumber = new Intl.NumberFormat("en-IN");

/** Indian-grouped INR: ₹5,00,000 (decimals only when the amount has paise). */
export function formatMoney(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? wholeRupees.format(value) : preciseRupees.format(value);
}

/** Indian-grouped plain number: 1,00,000 */
export function formatNumber(value: number): string {
  return indianNumber.format(value);
}

/** Signed money for breakdowns: − ₹1,50,000 */
export function formatSignedMoney(amount: number, sign: "+" | "-"): string {
  return `${sign === "-" ? "−" : "+"} ${formatMoney(Math.abs(amount))}`;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/** Business calendar date (yyyy-mm-dd or ISO timestamp) → 1 Nov 2026 */
export function formatDate(value: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string {
  if (!value) return "—";
  const dateOnly = parseDateOnly(value);
  if (dateOnly) {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(dateOnly);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone }).format(date);
}

/** Timestamp → 2 Oct 2026, 5:00 pm IST (always labelled with the business zone). */
export function formatDateTime(value: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short",
  }).format(date);
}

/** Time only, for schedule labels → 5:00 pm IST */
export function formatTime(value: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(date);
}

/** "10:00:00" (UTC clock time from group rules) → "10:00 UTC" */
export function formatClockTime(value: string): string {
  return `${value.slice(0, 5)} UTC`;
}

/** Ordinal day of month → "1st of every month" */
export function formatMonthlyDay(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix} of every month`;
}

/** READY_TO_START → Ready to start ; auctionOpened → Auction opened */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.includes("_") ? value.toLowerCase().replaceAll("_", " ") : value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "Rahul Patil" → "RP" */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** Time-of-day greeting in the business time zone. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: BUSINESS_TIME_ZONE }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
