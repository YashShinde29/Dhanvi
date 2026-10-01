import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { noContent, param } from "../../utils/http.js";
import type { applicationsQuery, applyBody, rejectBody } from "./organizer.schema.js";
import type { OrganizerService } from "./organizer.service.js";

export function organizerController(organizers: OrganizerService) {
  return {
    apply: async (req: FastifyRequest<{ Body: z.output<typeof applyBody> }>) => organizers.apply(req.actor().userId, req.body, req.correlationId),
    me: async (req: FastifyRequest) => organizers.myStatus(req.actor().userId),
    applications: async (req: FastifyRequest<{ Querystring: z.output<typeof applicationsQuery> }>) =>
      organizers.applications(req.query.page, req.query.pageSize, req.query.status, req.query.search),
    approve: async (req: FastifyRequest, reply: FastifyReply) => { await organizers.approve(param(req, "applicationId"), req.actor().userId, req.correlationId); return noContent(reply); },
    reject: async (req: FastifyRequest<{ Body: z.output<typeof rejectBody> }>, reply: FastifyReply) => {
      await organizers.reject(param(req, "applicationId"), req.actor().userId, req.body.reason, req.correlationId); return noContent(reply);
    },
    suspend: async (req: FastifyRequest, reply: FastifyReply) => { await organizers.suspend(param(req, "userId"), req.actor().userId, req.correlationId); return noContent(reply); },
  };
}
