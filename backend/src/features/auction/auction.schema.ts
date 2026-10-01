import { z } from "zod";
import { zDecimal, zEnum, zQueryInt } from "../../utils/schema.js";
import { RESCHEDULE_REASONS } from "./auction.domain.js";

export const bidBody = z.object({ discountAmount: zDecimal() });

const instant = () => z.string().transform((v, ctx) => {
  const d = new Date(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(d.getTime())) { ctx.addIssue({ code: "custom", message: "Use an ISO-8601 date-time with offset." }); return z.NEVER; }
  return d;
});
/** Both instants are absolute (UTC on the wire); the client converts the group-time-zone wall clock. */
export const rescheduleBody = z.object({
  newStartsAt: instant(), newEndsAt: instant(), reasonCode: zEnum(RESCHEDULE_REASONS).nullish(), reasonText: z.string().nullish(), memberMessage: z.string().nullish(),
  expectedScheduleVersion: z.number().int().nullish(),
});
export const historyQuery = (pageSize: number) => z.object({ page: zQueryInt(1), pageSize: zQueryInt(pageSize), cycleId: z.string().optional() });
