import { z } from "zod";
import { zQueryInt } from "../../utils/schema.js";

const s = () => z.string().nullish().transform((v) => v ?? "");
export const applyBody = z.object({ fullLegalName: z.string().nullish(), phone: z.string().nullish(), address: s(), city: s(), state: s(), postalCode: s(),
  reasonForBecomingOrganizer: s(), experienceDescription: z.string().nullish() });
export const rejectBody = z.object({ reason: s() });
export const applicationsQuery = z.object({ page: zQueryInt(1), pageSize: zQueryInt(20), status: z.string().optional(), search: z.string().optional() });
