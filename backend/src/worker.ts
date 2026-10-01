import { createPool } from "./config/database.js";
import { loadConfig } from "./config/index.js";
import { createRedis } from "./config/redis.js";
import { createServices } from "./infra/container.js";
import { Database } from "./infra/database/db.js";
import { createLogger } from "./infra/logger.js";
import { createAuctionQueue } from "./queues/auction.queue.js";
import { createReconciliationQueue } from "./queues/reconciliation.queue.js";
import { systemClock } from "./types/common.types.js";
import { startAuctionWorker } from "./workers/auction.worker.js";
import { startReconciliationWorker } from "./workers/reconciliation.worker.js";

/**
 * BullMQ worker process. Safe to run as several instances: repeatable sweeps are registered with
 * upsertJobScheduler (one schedule cluster-wide) and every job re-validates PostgreSQL state under row locks.
 */
const config = loadConfig();
const log = createLogger(config, "dhanvi-worker");
const pool = createPool({ connectionString: config.databaseUrl, max: Math.max(4, config.workerConcurrency * 2), applicationName: "dhanvi-worker" });
const db = new Database(pool, (err) => log.error({ err }, "after-commit hook failed"));
const queueConnection = createRedis(config.redisUrl, "queue");
const workerConnection = createRedis(config.redisUrl, "worker");
const auctionQueue = createAuctionQueue(queueConnection);
const reconciliationQueue = createReconciliationQueue(queueConnection);
const services = createServices({ config, db, clock: systemClock, log, auctionQueue: config.auction.automationEnabled ? auctionQueue : null });

const workers: Array<{ close(): Promise<void> }> = [];
if (config.auction.automationEnabled) {
  await auctionQueue.upsertJobScheduler("AUCTION_SWEEP", { every: config.auction.sweepIntervalSeconds * 1000 }, { name: "AUCTION_SWEEP", data: {} });
  workers.push(startAuctionWorker(services, workerConnection, log, config.workerConcurrency));
} else await auctionQueue.removeJobScheduler("AUCTION_SWEEP");
if (config.reconciliation.sweepEnabled) {
  await reconciliationQueue.upsertJobScheduler("RECONCILIATION_SWEEP", { every: config.reconciliation.sweepIntervalSeconds * 1000 }, { name: "RECONCILIATION_SWEEP", data: {} });
  workers.push(startReconciliationWorker(services, reconciliationQueue, workerConnection, log));
} else await reconciliationQueue.removeJobScheduler("RECONCILIATION_SWEEP");
log.info({ auctionAutomation: config.auction.automationEnabled, reconciliationSweep: config.reconciliation.sweepEnabled }, "worker started");

const shutdown = async () => {
  for (const w of workers) await w.close();
  await auctionQueue.close(); await reconciliationQueue.close();
  queueConnection.disconnect(); workerConnection.disconnect();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
