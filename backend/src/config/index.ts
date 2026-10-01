import { auctionConfig, type AuctionConfig } from "./auction.js";
import { authConfig, type AuthConfig } from "./auth.js";
import { parseEnv, type RawEnv } from "./env.js";
import { groupMemberPolicy, type GroupMemberPolicy } from "./groups.js";
import { financeConfig, type FinanceConfig } from "./payment.js";

export interface AppConfig {
  env: RawEnv["NODE_ENV"];
  host: string;
  port: number;
  logLevel: RawEnv["LOG_LEVEL"];
  swaggerEnabled: boolean;
  trustProxy: boolean;
  databaseUrl: string;
  databasePoolMax: number;
  runMigrationsOnStart: boolean;
  redisUrl: string;
  frontendOrigins: string[];
  workerConcurrency: number;
  reconciliation: { sweepEnabled: boolean; sweepIntervalSeconds: number };
  auth: AuthConfig;
  finance: FinanceConfig;
  auction: AuctionConfig;
  groupPolicy: GroupMemberPolicy;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = parseEnv(source);
  const origins = env.FRONTEND_ORIGIN.split(/[;,]/).map((o) => o.trim()).filter(Boolean);
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    swaggerEnabled: env.SWAGGER_ENABLED ? env.SWAGGER_ENABLED === "true" : env.NODE_ENV !== "production",
    trustProxy: env.TRUST_PROXY,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    runMigrationsOnStart: env.RUN_MIGRATIONS_ON_START,
    redisUrl: env.REDIS_URL,
    frontendOrigins: origins.length > 0 ? origins : ["http://localhost:3000", "http://localhost:3001"],
    workerConcurrency: env.WORKER_CONCURRENCY,
    reconciliation: { sweepEnabled: env.RECONCILIATION_SWEEP_ENABLED, sweepIntervalSeconds: env.RECONCILIATION_SWEEP_INTERVAL_SECONDS },
    auth: authConfig(env),
    finance: financeConfig(env),
    auction: auctionConfig(env),
    groupPolicy: groupMemberPolicy(env),
  };
}

export type { AuctionConfig, AuthConfig, FinanceConfig, GroupMemberPolicy };
