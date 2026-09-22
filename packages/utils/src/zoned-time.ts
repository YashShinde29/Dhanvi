/**
 * Group-time-zone wall clock ⇄ UTC instants for scheduling forms. The browser's own zone is never used as an authority:
 * every conversion goes through the IANA zone the group is configured with (e.g. Asia/Kolkata).
 */
const partsOf = (date: Date, timeZone: string) => {
  const map: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return map;
};

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** ISO instant (UTC) for a `YYYY-MM-DD` date and `HH:mm` time read as wall-clock time in `timeZone`. */
export function zonedToUtc(date: string, time: string, timeZone: string): string | null {
  const [y, m, d] = date.split("-").map(Number); const [hh, mm] = time.split(":").map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  const naive = Date.UTC(y!, m! - 1, d!, hh!, mm!, 0);
  // Two passes resolve the offset at the target instant itself (handles DST transitions for zones that have them).
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess).toISOString();
}

/** `{ date: "YYYY-MM-DD", time: "HH:mm" }` wall-clock fields in `timeZone` for an ISO instant — the inverse of zonedToUtc. */
export function utcToZonedFields(iso: string, timeZone: string): { date: string; time: string } {
  const p = partsOf(new Date(iso), timeZone); const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`, time: `${pad(p.hour! % 24)}:${pad(p.minute!)}` };
}

/** Human name of a time zone, e.g. "India Standard Time (IST)". */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const name = (style: "long" | "short") => new Intl.DateTimeFormat("en-IN", { timeZone, timeZoneName: style }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const long = name("long"), short = name("short");
  return long === short ? long : `${long} (${short})`;
}
