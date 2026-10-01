import type { FastifyRequest } from "fastify";
import { BadRequestError } from "../../utils/errors.js";
import { param, query } from "../../utils/http.js";
import { GUID } from "../../utils/schema.js";
import type { AdminOperationsService } from "./admin.service.js";

export function adminController(admin: AdminOperationsService) {
  return {
    overview: async () => admin.overview(),
    groups: async (req: FastifyRequest) => {
      const q = query(req);
      const text = (k: string) => (q[k]?.trim() ? q[k] : undefined);
      const n = (k: string, f: number) => { if (!q[k]) return f; if (!/^-?\d+$/.test(q[k]!)) throw new BadRequestError(`Invalid ${k}.`); return Number(q[k]); };
      if (q.organizerId && !GUID.test(q.organizerId)) throw new BadRequestError("Invalid organizerId.");
      return admin.groups({ status: text("status"), creatorType: text("creatorType"), groupType: text("groupType"), cycleStatus: text("cycleStatus"),
        organizerId: q.organizerId?.toLowerCase(), search: text("search"), page: n("page", 1), pageSize: n("pageSize", 25), sort: text("sort") });
    },
    group: async (req: FastifyRequest) => admin.group(param(req, "groupId")),
  };
}
