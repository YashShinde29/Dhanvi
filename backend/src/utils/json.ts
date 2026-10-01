/**
 * Exact JSON number handling. JavaScript would turn `5000.50` into a binary float; Dhanvi never lets money
 * pass through floating point. Every JSON number token that is not a safe integer literal is kept as its
 * original decimal text (e.g. "5000.50"), and money schemas convert that text with Decimal.
 * Requires JSON.parse source-text access (Node.js 21+).
 */
type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;

const preserveDecimals: Reviver = (_key, value, context) => {
  if (typeof value !== "number") return value;
  const source = context?.source;
  if (source === undefined) throw new Error("JSON source text access is unavailable; upgrade Node.js.");
  return Number.isSafeInteger(value) && /^-?\d+$/.test(source) ? value : source;
};

export function parseJsonPreservingDecimals(text: string): unknown {
  return JSON.parse(text, preserveDecimals as Parameters<typeof JSON.parse>[1]);
}

/** Emits a pre-formatted numeric token verbatim (e.g. "50000.00"), matching .NET decimal JSON output. */
export function rawJsonNumber(token: string): unknown {
  return (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON(token);
}
