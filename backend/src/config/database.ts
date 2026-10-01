import pg from "pg";
import { Decimal } from "../utils/money.js";
import { parseJsonPreservingDecimals } from "../utils/json.js";

const { Pool, types } = pg;

let parsersRegistered = false;

/**
 * Type parsing for the whole process. Registered once, before any pool is created:
 *  NUMERIC     → Decimal (never a JS number)
 *  INT8        → number (sequences and counts; guarded against precision loss)
 *  DATE        → "YYYY-MM-DD" text (business calendar days, no timezone shifting)
 *  TIMESTAMPTZ → Date (sessions run in UTC). Code that fingerprints µs-precision values selects them as text.
 *  JSON/JSONB  → decimals preserved as text, like HTTP bodies
 */
export function registerTypeParsers(): void {
  if (parsersRegistered) return;
  parsersRegistered = true;
  types.setTypeParser(types.builtins.NUMERIC, (v: string) => new Decimal(v));
  types.setTypeParser(types.builtins.INT8, (v: string) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error("INT8 value exceeds the safe integer range.");
    return n;
  });
  types.setTypeParser(types.builtins.DATE, (v: string) => v);
  types.setTypeParser(types.builtins.JSONB, (v: string) => parseJsonPreservingDecimals(v));
  types.setTypeParser(types.builtins.JSON, (v: string) => parseJsonPreservingDecimals(v));
}

export interface DatabaseOptions { connectionString: string; max: number; applicationName?: string }

/** The single connection pool per process. Features receive it through the app context; they never create pools. */
export function createPool(options: DatabaseOptions): pg.Pool {
  registerTypeParsers();
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max,
    application_name: options.applicationName ?? "dhanvi-api",
    // All timestamps are exchanged in UTC; business days use the group timezone explicitly.
    options: "-c TimeZone=UTC",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}
