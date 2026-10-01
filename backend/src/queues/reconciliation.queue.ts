import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const RECONCILIATION_QUEUE = "dhanvi-reconciliation";
export type ReconciliationJobName = "RECONCILIATION_SWEEP" | "RECONCILE_PAYMENT" | "RECONCILE_PAYOUT";
export interface ReconciliationJobData { paymentId?: string; payoutId?: string }

/** Payment and payout reconciliation share one queue: both are idempotent provider read-and-apply operations. */
export const createReconciliationQueue = (connection: Redis) => new Queue<ReconciliationJobData, unknown, ReconciliationJobName>(RECONCILIATION_QUEUE, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: { count: 5_000 } },
});
export type ReconciliationQueue = ReturnType<typeof createReconciliationQueue>;
