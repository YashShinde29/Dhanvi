import { Redis, type RedisOptions } from "ioredis";

/**
 * Central Redis connections. Redis carries BullMQ queues and delayed jobs only — it is never a financial source of
 * truth; every job re-reads PostgreSQL. Workers need maxRetriesPerRequest = null (BullMQ blocking commands).
 */
export function createRedis(url: string, role: "queue" | "worker"): Redis {
  const options: RedisOptions = { maxRetriesPerRequest: role === "worker" ? null : 3, enableReadyCheck: true, lazyConnect: false };
  return new Redis(url, options);
}
