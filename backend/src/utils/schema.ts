import { z } from "zod";
import { isDateOnly, normalizeTimeOnly } from "./dates.js";
import { parseEnum } from "./enums.js";
import { type Decimal, toDecimal } from "./money.js";

/**
 * Request schema building blocks. They reproduce how ASP.NET minimal APIs bound JSON: exact decimals, "yyyy-MM-dd"
 * DateOnly, "HH:mm[:ss]" TimeOnly, GUIDs, and enum names in SNAKE_CASE_UPPER (PascalCase also accepted).
 * Money arrives as an exact JSON token (see utils/json.ts) and becomes Decimal without passing through a float.
 */
export const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const zGuid = () => z.string().regex(GUID, "Invalid identifier.").transform((v) => v.toLowerCase());

export const zDecimal = () =>
  z.union([z.number(), z.string()]).transform((value, ctx): Decimal => {
    const d = toDecimal(value);
    if (!d) { ctx.addIssue({ code: "custom", message: "A decimal number is required." }); return z.NEVER; }
    return d;
  }).meta({ type: "number", description: "Exact decimal amount (sent as a JSON number)." });

export const zDateOnly = () => z.string().refine(isDateOnly, "Use the yyyy-MM-dd date format.").meta({ format: "date" });

export const zTimeOnly = () =>
  z.string().transform((value, ctx) => {
    const t = normalizeTimeOnly(value);
    if (!t) { ctx.addIssue({ code: "custom", message: "Use the HH:mm:ss time format." }); return z.NEVER; }
    return t;
  }).meta({ type: "string", example: "18:00:00" });

/** Enum accepted as SNAKE_CASE_UPPER (wire format) or PascalCase; resolves to the stored PascalCase name. */
export const zEnum = <T extends string>(names: readonly T[]) =>
  z.string().transform((value, ctx): T => {
    const parsed = parseEnum(value, names);
    if (!parsed) { ctx.addIssue({ code: "custom", message: `Expected one of ${names.join(", ")}.` }); return z.NEVER; }
    return parsed;
  });

/** Integer query parameter with a fallback, as `int? page` → `page ?? 1`. */
export const zQueryInt = (fallback: number) =>
  z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return fallback;
    const n = typeof v === "number" ? v : /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
    if (!Number.isSafeInteger(n)) { ctx.addIssue({ code: "custom", message: "Invalid number." }); return z.NEVER; }
    return n;
  });

export const zOptionalGuid = () => z.string().optional().transform((v, ctx) => {
  if (v === undefined || v === "") return undefined;
  if (!GUID.test(v)) { ctx.addIssue({ code: "custom", message: "Invalid identifier." }); return z.NEVER; }
  return v.toLowerCase();
});

export const idParams = <K extends string>(...keys: K[]) => z.object(Object.fromEntries(keys.map((k) => [k, zGuid()])) as Record<K, ReturnType<typeof zGuid>>);
