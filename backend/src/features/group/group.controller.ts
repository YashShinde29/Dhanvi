import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { BadRequestError } from "../../utils/errors.js";
import { parseEnum } from "../../utils/enums.js";
import { noContent, optionalActor, param, query } from "../../utils/http.js";
import { toDecimal } from "../../utils/money.js";
import { GUID } from "../../utils/schema.js";
import type { acceptTermsBody, reasonBody, saveGroupBody } from "./group.schema.js";
import type { GroupFilter, GroupOperation, GroupService } from "./group.service.js";
import { CREATOR_TYPES, type CreatorType, GROUP_STATUSES, GROUP_TYPES } from "./group.types.js";

/** GroupsEndpoints.Filter: invalid filters are 400 "Invalid {key}." like BadHttpRequestException. */
export function groupFilter(req: FastifyRequest): GroupFilter {
  const q = query(req);
  const e = <T extends string>(key: string, names: readonly T[]) => {
    if (!q[key]) return undefined;
    const v = parseEnum(q[key], names);
    if (!v) throw new BadRequestError(`Invalid ${key}.`);
    return v;
  };
  const amount = (key: string) => { if (!q[key]) return undefined; const d = toDecimal(q[key]); if (!d) throw new BadRequestError(`Invalid ${key}.`); return d; };
  const n = (key: string, fallback: number) => { if (!q[key]) return fallback; if (!/^-?\d+$/.test(q[key]!)) throw new BadRequestError(`Invalid ${key}.`); return Number(q[key]); };
  const organizerId = q.organizerId ? (GUID.test(q.organizerId) ? q.organizerId.toLowerCase() : (() => { throw new BadRequestError("Invalid organizerId."); })()) : undefined;
  return { groupType: e("groupType", GROUP_TYPES), creatorType: e("creatorType", CREATOR_TYPES), status: e("status", GROUP_STATUSES), minGroupValue: amount("minGroupValue"),
    maxGroupValue: amount("maxGroupValue"), memberLimit: q.memberLimit ? n("memberLimit", 20) : undefined, organizerId, page: n("page", 1), pageSize: n("pageSize", 20),
    sort: q.sort, search: q.search, section: q.section };
}

export function groupController(groups: GroupService) {
  const op = (operation: GroupOperation) => async (req: FastifyRequest<{ Body: z.output<typeof reasonBody> | undefined }>, reply: FastifyReply) => {
    await groups.execute(param(req, "id"), req.actor(), operation, { reason: req.body?.reason, membershipId: param(req, "membershipId") || undefined });
    return noContent(reply);
  };
  return {
    browsePublic: async (req: FastifyRequest) => groups.browse(groupFilter(req), optionalActor(req), "public"),
    browseMine: async (req: FastifyRequest) => groups.browse(groupFilter(req), req.actor(), "mine"),
    browseScope: (scope: "organizer" | "admin") => async (req: FastifyRequest) => groups.browse(groupFilter(req), req.actor(), scope),
    detailsPublic: async (req: FastifyRequest) => groups.get(param(req, "id"), optionalActor(req), false),
    detailsManaged: async (req: FastifyRequest) => groups.get(param(req, "id"), req.actor(), true),
    create: (creator: CreatorType) => async (req: FastifyRequest<{ Body: z.output<typeof saveGroupBody> }>) => groups.create(req.actor(), creator, req.body),
    update: async (req: FastifyRequest<{ Body: z.output<typeof saveGroupBody> }>) => groups.update(param(req, "id"), req.actor(), req.body),
    operation: op,
    acceptTerms: async (req: FastifyRequest<{ Body: z.output<typeof acceptTermsBody> }>, reply: FastifyReply) => {
      await groups.execute(param(req, "id"), req.actor(), "accept-terms", { termsVersionId: req.body.groupRuleVersionId ?? undefined, rulesHash: req.body.rulesHash ?? undefined });
      return noContent(reply);
    },
    members: async (req: FastifyRequest) => groups.members(param(req, "id"), req.actor()),
    contact: async (req: FastifyRequest) => groups.contact(param(req, "id"), req.actor()),
  };
}
