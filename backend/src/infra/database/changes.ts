import { Decimal as DecimalJs } from "decimal.js";
import type { Queryable } from "./db.js";

/**
 * Column-level change tracking, the equivalent of EF's "update only modified properties".
 * Rows are read with millisecond Dates, while rows written by .NET may hold microseconds; writing back an
 * unchanged column would silently truncate history and trip immutability triggers. Only changed columns are written.
 */
export type ColumnValues = Record<string, unknown>;
export type Snapshot = Record<string, string>;

const normalize = (v: unknown): string => {
  if (v === null || v === undefined) return "∅";
  if (v instanceof Date) return `d:${v.getTime()}`;
  if (v instanceof DecimalJs) return `n:${v.toFixed()}`;
  if (typeof v === "object") return `j:${JSON.stringify(v)}`;
  return `${typeof v}:${String(v)}`;
};

export const snapshot = (columns: ColumnValues): Snapshot => Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, normalize(v)]));

/** Writes changed columns; `guard` adds optimistic-concurrency conditions (e.g. {"Version": oldVersion}). Returns rows updated. */
export async function updateChanged(db: Queryable, table: string, id: string, before: Snapshot, after: ColumnValues, guard: ColumnValues = {},
  casts: Record<string, string> = {}): Promise<number> {
  const changed = Object.entries(after).filter(([k, v]) => before[k] !== normalize(v));
  if (changed.length === 0) return 1;
  const params: unknown[] = [id];
  const sets = changed.map(([k, v]) => {
    params.push(v instanceof DecimalJs ? v.toFixed() : v);
    return `"${k}" = $${params.length}${casts[k] ? `::${casts[k]}` : ""}`;
  });
  const conditions = Object.entries(guard).map(([k, v]) => { params.push(v); return `"${k}" = $${params.length}`; });
  return db.execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE "Id" = $1${conditions.map((c) => ` AND ${c}`).join("")}`, params);
}
