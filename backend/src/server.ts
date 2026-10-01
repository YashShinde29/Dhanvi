import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { createPool } from "./config/database.js";
import { loadConfig } from "./config/index.js";
import { createRedis } from "./config/redis.js";
import { createServices } from "./infra/container.js";
import { Database } from "./infra/database/db.js";
import { migrate } from "./infra/database/migrator.js";
import { seedLedgerAccounts } from "./infra/database/seed.js";
import { createLogger } from "./infra/logger.js";
import { createAuctionQueue } from "./queues/auction.queue.js";
import { systemClock } from "./types/common.types.js";

const config = loadConfig();
const log = createLogger(config, "dhanvi-api");
const pool = createPool({ connectionString: config.databaseUrl, max: config.databasePoolMax, applicationName: "dhanvi-api" });
const db = new Database(pool, (err) => log.error({ err, operation: "after-commit" }, "after-commit hook failed; the auction sweep will recover"));

if (config.runMigrationsOnStart) await migrate(pool, fileURLToPath(new URL("../sql", import.meta.url)), (m) => log.info(m));
const redis = createRedis(config.redisUrl, "queue");
redis.on("error", (err) => log.warn({ err: err.message }, "redis unavailable"));
const auctionQueue = config.auction.automationEnabled ? createAuctionQueue(redis) : null;
const services = createServices({ config, db, clock: systemClock, log, auctionQueue });
if (config.runMigrationsOnStart) { await seedLedgerAccounts(db, new Date()); await services.auth.seed(); }

const app = await buildApp({ config, services, logger: log });
const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await app.close();
  await auctionQueue?.close();
  redis.disconnect();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
await app.listen({ host: config.host, port: config.port });
