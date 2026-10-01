import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

const BASELINE = "0000_baseline";
const LOCK_KEY = 4_242_424_242;

export interface MigrationReport { adoptedBaseline: boolean; appliedBaseline: boolean; applied: string[] }

/**
 * Owns schema changes from the Fastify stack onward:
 *  1. dhanvi_meta.schema_migrations records every applied file with a checksum.
 *  2. An existing Dhanvi database (identity.users present) ADOPTS the existing schema as the baseline — the
 *     baseline SQL is never executed against it, so no table is recreated and no history is touched.
 *  3. An empty database executes the baseline once (tests, fresh local environments).
 *  4. sql/migrations/*.sql apply in order, each in its own transaction, under an advisory lock (safe with N instances).
 * Already-applied files with a changed checksum abort the run: history is append-only.
 */
export async function migrate(pool: pg.Pool, sqlDir: string, log: (message: string) => void = () => undefined): Promise<MigrationReport> {
  const client = await pool.connect();
  const report: MigrationReport = { adoptedBaseline: false, appliedBaseline: false, applied: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS dhanvi_meta`);
    await client.query(`CREATE TABLE IF NOT EXISTS dhanvi_meta.schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), mode text NOT NULL)`);
    const applied = new Map((await client.query<{ id: string; checksum: string }>(`SELECT id, checksum FROM dhanvi_meta.schema_migrations`)).rows.map((r) => [r.id, r.checksum]));
    const baselineSql = await readFile(join(sqlDir, "baseline", `${BASELINE}.sql`), "utf8");
    if (!applied.has(BASELINE)) {
      const existing = (await client.query(`SELECT to_regclass('identity.users') IS NOT NULL AS present`)).rows[0]?.present === true;
      if (existing) {
        await client.query(`INSERT INTO dhanvi_meta.schema_migrations (id, checksum, mode) VALUES ($1, $2, 'adopted')`, [BASELINE, checksum(baselineSql)]);
        report.adoptedBaseline = true; log(`Adopted the existing database schema as ${BASELINE}.`);
      } else {
        await client.query("BEGIN");
        await client.query(baselineSql);
        await client.query("SELECT pg_catalog.set_config('search_path', 'public', true)");
        await client.query(`INSERT INTO dhanvi_meta.schema_migrations (id, checksum, mode) VALUES ($1, $2, 'executed')`, [BASELINE, checksum(baselineSql)]);
        await client.query("COMMIT");
        report.appliedBaseline = true; log(`Created schema from ${BASELINE}.`);
      }
    }
    const files = (await readdir(join(sqlDir, "migrations"))).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const sql = await readFile(join(sqlDir, "migrations", file), "utf8");
      const known = applied.get(id);
      if (known) { if (known !== checksum(sql)) throw new Error(`Applied migration ${id} was modified; add a new migration instead.`); continue; }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO dhanvi_meta.schema_migrations (id, checksum, mode) VALUES ($1, $2, 'executed')`, [id, checksum(sql)]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      report.applied.push(id); log(`Applied ${id}.`);
    }
    return report;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
