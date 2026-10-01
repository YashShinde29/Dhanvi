import { type Job, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Services } from "../infra/container.js";
import { RECONCILIATION_QUEUE, type ReconciliationJobData, type ReconciliationJobName, type ReconciliationQueue } from "../queues/reconciliation.queue.js";

/** System actor for automated reconciliation: history rows record it; platform audit stores a null actor. */
export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const STALE_AFTER_MINUTES = 10;

/**
 * Optional automatic reconciliation (RECONCILIATION_SWEEP_ENABLED, default off — in .NET reconciliation was always an
 * operator action). It only re-runs the same idempotent reconcile use cases an admin can trigger.
 */
export async function processReconciliationJob(services: Services, queue: ReconciliationQueue | null, name: ReconciliationJobName, data: ReconciliationJobData) {
  if (name === "RECONCILE_PAYMENT" && data.paymentId) return services.payments.reconcileOne(data.paymentId, SYSTEM_ACTOR, true);
  if (name === "RECONCILE_PAYOUT" && data.payoutId) return services.payouts.reconcile(data.payoutId, SYSTEM_ACTOR, true);
  if (name !== "RECONCILIATION_SWEEP" || !queue) return null;
  const db = services.db;
  const payments = await db.query<{ Id: string }>(`SELECT "Id" FROM payments."Payments" WHERE "Status" IN ('Created','Pending','Authorized')
    AND "ReconciliationStatus" IN ('Pending','Failed') AND "UpdatedAt" < now() - make_interval(mins => ${STALE_AFTER_MINUTES})`);
  const payouts = await db.query<{ Id: string }>(`SELECT "Id" FROM payouts."PayoutObligations" WHERE "Status" IN ('Processing','ProviderPending') AND "UpdatedAt" < now() - make_interval(mins => ${STALE_AFTER_MINUTES})`);
  for (const p of payments) await queue.add("RECONCILE_PAYMENT", { paymentId: p.Id }, { jobId: `RECONCILE_PAYMENT-${p.Id}` });
  for (const p of payouts) await queue.add("RECONCILE_PAYOUT", { payoutId: p.Id }, { jobId: `RECONCILE_PAYOUT-${p.Id}` });
  return { payments: payments.length, payouts: payouts.length };
}

export function startReconciliationWorker(services: Services, queue: ReconciliationQueue, connection: Redis, log: Logger) {
  const worker = new Worker<ReconciliationJobData, unknown, ReconciliationJobName>(RECONCILIATION_QUEUE, async (job: Job<ReconciliationJobData, unknown, ReconciliationJobName>) => {
    const result = await processReconciliationJob(services, queue, job.name, job.data);
    log.info({ operation: `reconciliation.${job.name}`, jobId: job.id }, "reconciliation job processed");
    return result === null ? null : true;
  }, { connection, concurrency: 2 });
  worker.on("failed", (job, err) => log.error({ operation: `reconciliation.${job?.name}`, jobId: job?.id, err }, "reconciliation job failed"));
  return worker;
}
