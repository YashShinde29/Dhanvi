import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { BadRequestError } from "../../utils/errors.js";
import { parseEnum } from "../../utils/enums.js";
import { header, param, query } from "../../utils/http.js";
import { GUID } from "../../utils/schema.js";
import { CONTRIBUTION_STATUSES } from "../contribution/contribution.domain.js";
import type { recordBody, reverseBody } from "./cycle.schema.js";
import type { CycleService } from "./cycle.service.js";

export function cycleController(cycles: CycleService) {
  const ids = (req: FastifyRequest) => ({ groupId: param(req, "groupId"), cycleId: param(req, "cycleId"), contributionId: param(req, "contributionId") });
  return {
    activate: async (req: FastifyRequest) => cycles.activate(param(req, "groupId"), req.actor()),
    cycles: (management: boolean) => async (req: FastifyRequest) => cycles.cycles(param(req, "groupId"), req.actor(), management),
    cycle: async (req: FastifyRequest) => cycles.cycle(param(req, "groupId"), param(req, "cycleId"), req.actor()),
    myGroupContributions: async (req: FastifyRequest) => cycles.myGroupContributions(param(req, "groupId"), req.actor()),
    myContributions: async (req: FastifyRequest) => {
      const q = query(req);
      let status;
      if (q.status) { status = parseEnum(q.status, CONTRIBUTION_STATUSES); if (!status) throw new BadRequestError("Invalid contribution status."); }
      if (q.groupId && !GUID.test(q.groupId)) throw new BadRequestError("Invalid groupId.");
      const int = (v: string | undefined, f: number) => { if (!v) return f; if (!/^-?\d+$/.test(v)) throw new BadRequestError("Invalid page."); return Number(v); };
      return cycles.myContributions(req.actor(), q.groupId?.toLowerCase(), status ?? undefined, int(q.page, 1), int(q.pageSize, 20));
    },
    cycleContributions: async (req: FastifyRequest) => cycles.cycleContributions(param(req, "groupId"), param(req, "cycleId"), req.actor()),
    record: async (req: FastifyRequest<{ Body: z.output<typeof recordBody> }>) => {
      const { groupId, cycleId, contributionId } = ids(req);
      return cycles.record(groupId, cycleId, contributionId, req.actor(), header(req, "Idempotency-Key"),
        { amount: req.body.amount.value, amountToken: req.body.amount.token, reference: req.body.reference, note: req.body.note });
    },
    reverse: async (req: FastifyRequest<{ Body: z.output<typeof reverseBody> }>) => {
      const { groupId, cycleId, contributionId } = ids(req);
      return cycles.reverse(groupId, cycleId, contributionId, req.actor(), header(req, "Idempotency-Key"), req.body);
    },
    markOverdue: async (req: FastifyRequest) => ({ markedCount: await cycles.markOverdue(param(req, "groupId"), req.actor()) }),
  };
}
