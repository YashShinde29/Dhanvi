/**
 * Calendar helpers. Business days are DateOnly values ("YYYY-MM-DD") evaluated in the group timezone
 * (BusinessCalendar.DefaultTimeZone = Asia/Kolkata). Instants are UTC Dates.
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export type DateOnly = string; // YYYY-MM-DD
export type TimeOnly = string; // HH:mm:ss

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,7}))?)?$/;

/** BusinessCalendar.Today(utcNow, timeZone) */
export function businessToday(now: Date, timeZone: string = DEFAULT_TIME_ZONE): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone }); return true; } catch { return false; }
}

export function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day || year < 1) return null;
  return { year, month, day };
}

export const isDateOnly = (value: unknown): value is DateOnly => typeof value === "string" && parseDateOnly(value) !== null;

export function makeDateOnly(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** DateOnly.AddMonths: same day, clamped to the target month's last day. */
export function addMonths(date: DateOnly, months: number): DateOnly {
  const d = parseDateOnly(date);
  if (!d) throw new RangeError(`Invalid DateOnly ${date}`);
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12), month = (index % 12) + 1;
  return makeDateOnly(year, month, Math.min(d.day, daysInMonth(year, month)));
}

/** DateOnly comparison (lexicographic order is chronological for YYYY-MM-DD). */
export const compareDateOnly = (a: DateOnly, b: DateOnly): number => (a < b ? -1 : a > b ? 1 : 0);

/** Normalizes TimeOnly input to "HH:mm:ss" (System.Text.Json accepts "HH:mm" and "HH:mm:ss[.fffffff]"). */
export function normalizeTimeOnly(value: string): TimeOnly | null {
  const m = TIME_ONLY.exec(value.trim());
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}${m[4] && /[1-9]/.test(m[4]) ? `.${m[4].replace(/0+$/, "")}` : ""}`;
}

/**
 * `new DateTimeOffset(date.ToDateTime(time), TimeSpan.Zero)`: the auction rules publish UTC clock times and the
 * cycle's selection date supplies the calendar day. Do not reinterpret existing rules as local times.
 */
export function utcInstant(date: DateOnly, time: TimeOnly): Date {
  const d = parseDateOnly(date);
  const t = TIME_ONLY.exec(time);
  if (!d || !t) throw new RangeError("Invalid date or time");
  const ms = t[4] ? Number(`0.${t[4]}`) * 1000 : 0;
  return new Date(Date.UTC(d.year, d.month - 1, d.day, Number(t[1]), Number(t[2]), Number(t[3] ?? 0), Math.floor(ms)));
}

/** Midnight UTC of a DateOnly, as .NET `new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)`. */
export const dateOnlyMidnightUtc = (date: DateOnly): Date => utcInstant(date, "00:00:00");

/** "O" round-trip format of a UTC DateTimeOffset: 7 fractional digits, "+00:00". */
export function roundTripUtc(date: Date): string {
  const iso = date.toISOString(); // 2026-10-05T12:30:00.123Z
  return `${iso.slice(0, 19)}.${iso.slice(20, 23)}0000+00:00`;
}

export const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);
