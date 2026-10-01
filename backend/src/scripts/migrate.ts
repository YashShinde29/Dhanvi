import { fileURLToPath } from "node:url";
import { createPool } from "../config/database.js";
import { parseEnv } from "../config/env.js";
import { migrate } from "../infra/database/migrator.js";

/** npm run db:migrate — adopts an existing Dhanvi database or builds a fresh one, then applies sql/migrations. */
const env = parseEnv();
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2, applicationName: "dhanvi-migrate" });
try {
  const report = await migrate(pool, fileURLToPath(new URL("../../sql", import.meta.url)), (m) => console.log(m));
  console.log(JSON.stringify(report));
} finally {
  await pool.end();
}
