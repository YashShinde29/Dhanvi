import type { FastifyReply, FastifyRequest } from "fastify";
import { isDateOnly } from "../../utils/dates.js";
import { BadRequestError } from "../../utils/errors.js";
import { parseEnum } from "../../utils/enums.js";
import { param, query } from "../../utils/http.js";
import { GUID } from "../../utils/schema.js";
import { ACCOUNTING_EVENT_TYPES } from "./ledger.domain.js";
import type { LedgerFilter, LedgerQueries } from "./ledger.queries.js";

/** LedgerEndpoints.Filter */
function filter(req: FastifyRequest): LedgerFilter {
  const q = query(req);
  const date = (k: string) => { if (!q[k]) return undefined; if (!isDateOnly(q[k])) throw new BadRequestError("Invalid ledger date."); return q[k]; };
  const id = (k: string) => { if (!q[k]) return undefined; if (!GUID.test(q[k]!)) throw new BadRequestError("Invalid ledger reference."); return q[k]!.toLowerCase(); };
  const n = (k: string, f: number) => { if (!q[k]) return f; if (!/^-?\d+$/.test(q[k]!)) throw new BadRequestError("Invalid page."); return Number(q[k]); };
  let eventType;
  if (q.eventType) { eventType = parseEnum(q.eventType, ACCOUNTING_EVENT_TYPES); if (!eventType) throw new BadRequestError("Invalid event type."); }
  return { from: date("from"), to: date("to"), eventType: eventType ?? undefined, account: q.account, groupId: id("groupId"), cycleId: id("cycleId"), journalNumber: q.journalNumber,
    page: n("page", 1), pageSize: n("pageSize", 20) };
}

export function ledgerController(ledger: LedgerQueries) {
  return {
    accounts: async () => (await ledger.accounts()).map(({ raw: _raw, ...a }) => a),
    journals: async (req: FastifyRequest) => ledger.journals(filter(req)),
    journal: async (req: FastifyRequest) => ledger.journal(param(req, "id")),
    trialBalance: async (req: FastifyRequest) => ledger.trialBalance(filter(req)),
    groupJournals: async (req: FastifyRequest) => ledger.journals({ ...filter(req), groupId: param(req, "groupId") }),
    groupBalances: async (req: FastifyRequest) => ledger.trialBalance({ ...filter(req), groupId: param(req, "groupId") }),
    accountBalance: async (req: FastifyRequest, reply: FastifyReply) => {
      const balances = await ledger.trialBalance({ ...filter(req), account: undefined });
      const account = balances.accounts.find((a) => a.code === (req.params as { code: string }).code);
      return account ?? reply.status(404).send();
    },
    member: async (req: FastifyRequest) => ledger.member(req.actor().userId, filter(req)),
  };
}
