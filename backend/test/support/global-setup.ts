import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrate } from "../../src/infra/database/migrator.js";

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;

/**
 * Real PostgreSQL 17 (never SQLite: locks, deferred constraint triggers and NUMERIC semantics are under test) and
 * real Redis for BullMQ. The baseline + migrations are applied once to a template database; each test file clones it.
 */
export default async function setup(project: TestProject) {
  postgres = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("dhanvi_template").withUsername("dhanvi").withPassword("dhanvi").start();
  redis = await new RedisContainer("redis:7-alpine").start();
  const pool = new pg.Pool({ connectionString: postgres.getConnectionUri(), max: 2 });
  await migrate(pool, fileURLToPath(new URL("../../sql", import.meta.url)));
  await pool.end();
  project.provide("pgAdminUri", postgres.getConnectionUri().replace(/\/dhanvi_template$/, "/postgres"));
  project.provide("pgTemplate", "dhanvi_template");
  project.provide("redisUrl", redis.getConnectionUrl());
  return async () => { await redis.stop(); await postgres.stop(); };
}

declare module "vitest" {
  export interface ProvidedContext { pgAdminUri: string; pgTemplate: string; redisUrl: string }
}
