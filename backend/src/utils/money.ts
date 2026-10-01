import { Decimal as DecimalJs } from "decimal.js";
import { rawJsonNumber } from "./json.js";

/**
 * Decimal arithmetic for every monetary value (PostgreSQL NUMERIC(18,2) ↔ decimal.js). JavaScript numbers are
 * never used for money: inputs arrive as exact decimal text (see utils/json.ts) and NUMERIC columns are parsed
 * straight into Decimal. Precision 40 comfortably exceeds .NET decimal's 28–29 significant digits.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN, toExpNeg: -40, toExpPos: 40 });
export type Decimal = DecimalJs;

// Responses carry money as JSON numbers with the database scale ("50000.00"), exactly like the .NET API.
(Decimal.prototype as unknown as { toJSON(): unknown }).toJSON = function (this: DecimalJs) {
  return rawJsonNumber(this.decimalPlaces() > 2 ? this.toFixed() : this.toFixed(2));
};

export const ZERO = new Decimal(0);
/** The largest value of NUMERIC(18,2) and the .NET guard `amount <= 9999999999999999.99m`. */
export const MAX_AMOUNT = new Decimal("9999999999999999.99");

const DECIMAL_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** Converts an exact JSON token / NUMERIC / Decimal into Decimal. Returns null for anything not a finite decimal. */
export function toDecimal(value: unknown): Decimal | null {
  if (value instanceof DecimalJs) return new Decimal(value);
  if (typeof value === "number") return Number.isFinite(value) ? new Decimal(value) : null;
  if (typeof value === "string" && DECIMAL_TEXT.test(value.trim())) return new Decimal(value.trim());
  return null;
}

export function dec(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

/** `decimal.Round(x, 2) == x` in the .NET domain: the value is exact to paise. */
export const isPaise = (value: Decimal): boolean => value.decimalPlaces() <= 2;

/** `x * 100 % n == 0`: the amount divides into exact paise shares across n positions. */
export const dividesIntoPaise = (value: Decimal, parts: number): boolean => value.times(100).mod(parts).isZero();

export const sum = (values: Iterable<Decimal>): Decimal => {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(v);
  return total;
};

/** Port of PaymentMoney.ToMinorUnits: positive, ≤ MAX, exact to paise. */
export function toMinorUnits(amount: Decimal): bigint {
  if (!(amount.gt(0) && amount.lte(MAX_AMOUNT) && isPaise(amount))) throw new RangeError("INVALID_PAYMENT_AMOUNT");
  return BigInt(amount.times(100).toFixed(0));
}

export function fromMinorUnits(amount: bigint | number): Decimal {
  const value = BigInt(amount);
  if (value < 0n) throw new RangeError("INVALID_PAYMENT_AMOUNT");
  return new Decimal(value.toString()).dividedBy(100);
}

/** Fixed two-decimal text, the NUMERIC(18,2) representation used in fingerprints. */
export const money2 = (value: Decimal): string => value.toFixed(2);
