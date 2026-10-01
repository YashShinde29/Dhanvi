import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { pino } from "pino";
import { inject } from "vitest";
import { buildApp } from "../../src/app.js";
import { createPool } from "../../src/config/database.js";
import { type AppConfig, loadConfig } from "../../src/config/index.js";
import { createServices, type Services } from "../../src/infra/container.js";
import { Database } from "../../src/infra/database/db.js";
import { seedLedgerAccounts } from "../../src/infra/database/seed.js";
import type { AuctionQueue } from "../../src/queues/auction.queue.js";
import type { Clock } from "../../src/types/common.types.js";
import { FakeRazorpay } from "./fake-razorpay.js";

/** Controllable server clock: tests move time deterministically through auction windows and closing phases. */
export class TestClock implements Clock {
  constructor(private current: Date = new Date()) {}
  now() { return new Date(this.current); }
  set(date: Date | string) { this.current = new Date(date); }
  advance(seconds: number) { this.current = new Date(this.current.getTime() + seconds * 1000); }
}

/** Wall-clock time for end-to-end BullMQ runs (delayed jobs fire in real time). */
class RealClock extends TestClock { override now() { return new Date(); } }

export interface Harness {
  app: FastifyInstance; services: Services; db: Database; clock: TestClock; config: AppConfig; razorpay: FakeRazorpay; databaseName: string; close(): Promise<void>;
}

/** Fresh database cloned from the migrated template, full Fastify app in-process (app.inject — no network). */
export async function createHarness(options: { env?: Record<string, string>; auctionQueue?: AuctionQueue | null; now?: string; realClock?: boolean } = {}): Promise<Harness> {
  const databaseName = `t_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const admin = new pg.Client({ connectionString: inject("pgAdminUri") });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE ${inject("pgTemplate")}`);
  await admin.end();
  const url = inject("pgAdminUri").replace(/\/postgres$/, `/${databaseName}`);
  const config = loadConfig({
    NODE_ENV: "test", DATABASE_URL: url, REDIS_URL: inject("redisUrl"), JWT_SIGNING_KEY: "integration-test-signing-key-0123456789abcdef", JWT_SECURE_COOKIES: "false",
    LOG_LEVEL: "silent", SWAGGER_ENABLED: "false", PAYMENTS_RAZORPAY_ENABLED: "true", RAZORPAY_KEY_ID: "rzp_test_harness01", RAZORPAY_KEY_SECRET: "key-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret", AUCTION_GOING_ONCE_SECONDS: "30", AUCTION_GOING_TWICE_SECONDS: "30", AUCTION_FINAL_WARNING_SECONDS: "30", ...options.env,
  });
  const pool = createPool({ connectionString: url, max: 10 });
  const db = new Database(pool);
  const clock = options.realClock ? new RealClock() : new TestClock(options.now ? new Date(options.now) : new Date());
  const razorpay = new FakeRazorpay(config.finance.razorpay);
  const log = pino({ level: "silent" });
  const services = createServices({ config, db, clock, log, auctionQueue: options.auctionQueue ?? null, paymentGateway: razorpay });
  await seedLedgerAccounts(db, clock.now());
  await services.auth.seed();
  const app = await buildApp({ config, services, logger: false });
  await app.ready();
  return { app, services, db, clock, config, razorpay, databaseName, close: async () => { await app.close(); await pool.end(); } };
}

export interface TestUser { id: string; email: string; token: string }

let counter = 0;
export async function registerUser(h: Harness, roles: string[] = [], name = "Member"): Promise<TestUser> {
  counter++;
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${counter}.${Date.now()}@example.com`;
  const reg = await h.app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { firstName: name, lastName: `Tester${counter}`, email, phoneNumber: null, password: "Passw0rd!" } });
  if (reg.statusCode !== 200) throw new Error(`register failed ${reg.statusCode} ${reg.body}`);
  const id = reg.json().id as string;
  for (const role of roles)
    await h.db.execute(`INSERT INTO identity.user_roles ("UserId","RoleId","AssignedAt") SELECT $1, "Id", now() FROM identity.roles WHERE "Name" = $2`, [id, role]);
  if (roles.includes("ORGANIZER"))
    await h.db.execute(`INSERT INTO organizers.organizer_profiles ("Id","UserId","Status","ApprovedAt","CreatedAt","UpdatedAt") VALUES ($1,$2,'Approved',now(),now(),now())`, [randomUUID(), id]);
  // Tokens are minted at wall-clock time (JWT lifetime is validated against real time); login itself is covered in identity tests.
  const user = (await h.services.auth.currentUser(id));
  const token = await h.services.tokens.createAccessToken({ id, email }, user.roles as never, new Date());
  return { id, email, token };
}

export type Call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers?: Record<string, string>) => Promise<LightMyRequestResponse>;
export const as = (h: Harness, user: TestUser | null): Call => (method, url, payload, headers = {}) =>
  h.app.inject({ method, url: `/api/v1/${url.replace(/^\//, "")}`, ...(payload === undefined ? {} : typeof payload === "string" ? { payload, headers: { "content-type": "application/json", ...headers } } : { payload: payload as object }),
    headers: { ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(typeof payload === "string" ? { "content-type": "application/json" } : {}), ...headers } });

export function expectOk(res: LightMyRequestResponse, status = 200) {
  if (res.statusCode !== status) throw new Error(`Expected ${status}, got ${res.statusCode}: ${res.body}`);
  return res.body ? res.json() : undefined;
}
