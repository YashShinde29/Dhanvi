import type { FastifyRequest } from "fastify";
import { BadRequestError } from "../../utils/errors.js";
import { parseEnum } from "../../utils/enums.js";
import { header, param, query } from "../../utils/http.js";
import { GUID } from "../../utils/schema.js";
import type { AuthService } from "../auth/auth.service.js";
import { PAYOUT_STATUSES, PAYOUT_TYPES } from "./payout.domain.js";
import type { PayoutService } from "./payout.service.js";

const intQ = (v: string | undefined, f: number) => { if (!v) return f; if (!/^-?\d+$/.test(v)) throw new BadRequestError("Invalid page."); return Number(v); };
const enumQ = <T extends string>(v: string | undefined, names: readonly T[], key: string) => { if (!v) return undefined; const s = parseEnum(v, names); if (!s) throw new BadRequestError(`Invalid ${key}.`); return s; };
const guidQ = (v: string | undefined, key: string) => { if (!v) return undefined; if (!GUID.test(v)) throw new BadRequestError(`Invalid ${key}.`); return v.toLowerCase(); };
const dateQ = (v: string | undefined, key: string) => { if (!v) return undefined; const d = new Date(v); if (Number.isNaN(d.getTime())) throw new BadRequestError(`Invalid ${key}.`); return d; };

export function payoutController(payouts: PayoutService, auth: AuthService) {
  return {
    adminList: async (req: FastifyRequest) => {
      const q = query(req);
      return payouts.list(req.actor().userId, true, guidQ(q.groupId, "groupId"), intQ(q.page, 1), enumQ(q.status, PAYOUT_STATUSES, "status"), enumQ(q.type, PAYOUT_TYPES, "type"),
        { cycleId: guidQ(q.cycleId, "cycleId"), from: dateQ(q.from, "from"), to: dateQ(q.to, "to") });
    },
    myList: async (req: FastifyRequest) => {
      const q = query(req);
      return payouts.list(req.actor().userId, false, undefined, intQ(q.page, 1), enumQ(q.status, PAYOUT_STATUSES, "status"), enumQ(q.type, PAYOUT_TYPES, "type"));
    },
    organizerList: async (req: FastifyRequest) => payouts.list(req.actor().userId, false, param(req, "groupId"), intQ(query(req).page, 1), undefined, undefined),
    details: (admin: boolean) => async (req: FastifyRequest) => payouts.details(param(req, "id"), req.actor().userId, admin),
    approve: async (req: FastifyRequest) => payouts.approve(param(req, "id"), req.actor().userId, true),
    execute: (retry: boolean) => async (req: FastifyRequest) => payouts.execute(param(req, "id"), req.actor().userId, true, header(req, "Idempotency-Key"), retry),
    reconcile: async (req: FastifyRequest) => payouts.reconcile(param(req, "id"), req.actor().userId, true),
    prepare: async (req: FastifyRequest) => payouts.prepareCycleSettlement(param(req, "cycleId"), req.actor().userId, true),
    evaluate: async (req: FastifyRequest) => payouts.evaluateCycleSettlement(param(req, "cycleId"), req.actor().userId, true),
    account: async (req: FastifyRequest) => payouts.account(req.actor().userId),
    /** Step-up: the account password is re-verified before a payout destination changes. */
    addAccount: async (req: FastifyRequest<{ Body: { accountHolderName?: string | null; accountNumber?: string | null; confirmAccountNumber?: string | null; ifsc?: string | null; bankName?: string | null; password?: string | null } | undefined }>) => {
      const b = req.body ?? {};
      await auth.verifyUserPassword(req.actor().userId, b.password ?? "");
      return payouts.addAccount(req.actor().userId, { accountHolderName: b.accountHolderName ?? "", accountNumber: b.accountNumber ?? "", confirmAccountNumber: b.confirmAccountNumber ?? "",
        ifsc: b.ifsc ?? "", bankName: b.bankName });
    },
  };
}
