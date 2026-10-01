import { z } from "zod";
import { zDecimal, zGuid } from "../../utils/schema.js";

/** The exact amount token is kept for the .NET-compatible idempotency request hash. */
export const recordBody = z.object({
  amount: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const parsed = zDecimal().safeParse(v);
    if (!parsed.success) { ctx.addIssue({ code: "custom", message: "A decimal number is required." }); return z.NEVER; }
    return { value: parsed.data, token: typeof v === "number" ? String(v) : v };
  }),
  reference: z.string().nullish().transform((v) => v ?? ""),
  note: z.string().nullish(),
});
export const reverseBody = z.object({ entryId: zGuid(), reason: z.string().nullish().transform((v) => v ?? "") });
