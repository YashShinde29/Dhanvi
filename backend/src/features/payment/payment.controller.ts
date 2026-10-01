import type { FastifyReply, FastifyRequest } from "fastify";
import { GatewayUnavailableError, InvalidProviderEventError } from "../../infra/razorpay/razorpay.gateway.js";
import { BadRequestError } from "../../utils/errors.js";
import { parseEnum } from "../../utils/enums.js";
import { header, param, query } from "../../utils/http.js";
import { PAYMENT_STATUSES } from "./payment.domain.js";
import type { PaymentService } from "./payment.service.js";

const intQ = (v: string | undefined, f: number) => { if (!v) return f; if (!/^-?\d+$/.test(v)) throw new BadRequestError("Invalid page."); return Number(v); };
const statusQ = (v: string | undefined) => { if (!v) return undefined; const s = parseEnum(v, PAYMENT_STATUSES); if (!s) throw new BadRequestError("Invalid status."); return s; };

export function paymentController(payments: PaymentService) {
  return {
    eligibility: async (req: FastifyRequest) => payments.eligibility(param(req, "contributionId"), req.actor().userId),
    create: async (req: FastifyRequest) => payments.create(param(req, "contributionId"), req.actor().userId, header(req, "Idempotency-Key")),
    verify: async (req: FastifyRequest<{ Body: { razorpayOrderId?: string | null; razorpayPaymentId?: string | null; razorpaySignature?: string | null } | undefined }>) =>
      payments.verify(param(req, "id"), req.actor().userId, { razorpayOrderId: req.body?.razorpayOrderId ?? "", razorpayPaymentId: req.body?.razorpayPaymentId ?? "", razorpaySignature: req.body?.razorpaySignature ?? "" }),
    refresh: async (req: FastifyRequest) => payments.reconcileOne(param(req, "id"), req.actor().userId, false),
    details: (admin: boolean) => async (req: FastifyRequest) => payments.details(param(req, "id"), req.actor().userId, admin),
    list: (admin: boolean) => async (req: FastifyRequest) => { const q = query(req); return payments.list(req.actor().userId, admin, intQ(q.page, 1), intQ(q.pageSize, 20), statusQ(q.status)); },
    reconcile: async (req: FastifyRequest) => payments.reconcileOne(param(req, "id"), req.actor().userId, true),
    /** Anonymous; authenticity comes only from the HMAC over the exact raw bytes. */
    webhook: async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.rawBody ?? Buffer.alloc(0);
      if (body.length > 1024 * 1024) return reply.status(413).send();
      try {
        await payments.processWebhook(body, header(req, "X-Razorpay-Signature"), header(req, "X-Razorpay-Event-Id") || undefined);
        return { received: true };
      } catch (error) {
        if (error instanceof InvalidProviderEventError) return reply.status(400).send({ code: "INVALID_PROVIDER_EVENT" });
        if (error instanceof GatewayUnavailableError) return reply.status(503).send();
        throw error;
      }
    },
  };
}
