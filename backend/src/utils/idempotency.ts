import type { Queryable } from "../infra/database/db.js";
import { BusinessRuleError, requireRule } from "./errors.js";

/**
 * Shared operation receipts (groups."IdempotencyRecords", unique on Scope+Key, append-only by trigger).
 * A receipt binds an idempotency key to the hash of the request that produced ResultId; replaying the same key
 * with a different request is rejected (IdempotencyRecord.ValidateReplay).
 */
export interface Receipt { id: string; scope: string; key: string; requestHash: string; resultId: string; createdAt: Date }

export const Scopes = {
  /** Manual contribution record/reverse receipts, one namespace per group. */
  contribution: (groupId: string) => `group:${groupId.toLowerCase()}`,
  /** Exactly 100 characters: "a:" + three hyphen-less GUIDs. */
  bid: (groupId: string, cycleId: string, actorId: string) => `a:${n(groupId)}:${n(cycleId)}:${n(actorId)}`,
  reschedule: (groupId: string, cycleId: string, actorId: string) => `r:${n(groupId)}:${n(cycleId)}:${n(actorId)}`,
};
function n(id: string) { return id.replace(/-/g, "").toLowerCase(); }

export function validateReplay(receipt: Receipt, requestHash: string): void {
  if (receipt.requestHash !== requestHash)
    throw new BusinessRuleError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different request. Use a new key for a new operation.");
}

export function requireIdempotencyKey(key: string | undefined, max: number, message: string): string {
  requireRule(!!key && key.trim().length > 0 && key.length <= max, "IDEMPOTENCY_KEY_REQUIRED", message);
  return key;
}

export async function findReceipts(db: Queryable, scopes: string[]): Promise<Receipt[]> {
  const rows = await db.query<{ Id: string; Scope: string; Key: string; RequestHash: string; ResultId: string; CreatedAt: Date }>(
    `SELECT "Id","Scope","Key","RequestHash","ResultId","CreatedAt" FROM groups."IdempotencyRecords" WHERE "Scope" = ANY($1::text[])`, [scopes]);
  return rows.map((r) => ({ id: r.Id, scope: r.Scope, key: r.Key, requestHash: r.RequestHash, resultId: r.ResultId, createdAt: r.CreatedAt }));
}

export async function findReceipt(db: Queryable, scope: string, key: string): Promise<Receipt | null> {
  const r = await db.maybeOne<{ Id: string; Scope: string; Key: string; RequestHash: string; ResultId: string; CreatedAt: Date }>(
    `SELECT "Id","Scope","Key","RequestHash","ResultId","CreatedAt" FROM groups."IdempotencyRecords" WHERE "Scope" = $1 AND "Key" = $2`, [scope, key]);
  return r && { id: r.Id, scope: r.Scope, key: r.Key, requestHash: r.RequestHash, resultId: r.ResultId, createdAt: r.CreatedAt };
}

export async function insertReceipt(db: Queryable, r: Receipt): Promise<void> {
  await db.execute(`INSERT INTO groups."IdempotencyRecords" ("Id","Scope","Key","RequestHash","ResultId","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6)`,
    [r.id, r.scope, r.key, r.requestHash, r.resultId, r.createdAt]);
}
