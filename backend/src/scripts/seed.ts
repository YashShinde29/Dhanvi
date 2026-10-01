import pino from "pino";
import { createPool } from "../config/database.js";
import { loadConfig } from "../config/index.js";
import { createServices } from "../infra/container.js";
import { Database } from "../infra/database/db.js";
import { seedLedgerAccounts } from "../infra/database/seed.js";
import { systemClock } from "../types/common.types.js";

/** npm run db:seed — roles, system ledger accounts and (when DHANVI_SEED_ADMIN_ENABLED) the initial SUPER_ADMIN. Idempotent. */
const config = loadConfig();
const pool = createPool({ connectionString: config.databaseUrl, max: 2, applicationName: "dhanvi-seed" });
try {
  const db = new Database(pool);
  await seedLedgerAccounts(db, new Date());
  await createServices({ config, db, clock: systemClock, log: pino({ level: "info" }), auctionQueue: null }).auth.seed();
  console.log("Seed complete.");
} finally {
  await pool.end();
}
