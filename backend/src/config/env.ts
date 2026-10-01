import { z } from "zod";

/**
 * Typed environment. Names follow the existing Dhanvi .env conventions (JWT_SIGNING_KEY, FRONTEND_ORIGIN,
 * PAYMENTS_RAZORPAY_ENABLED, RAZORPAY_*, DHANVI_SEED_ADMIN_*), so one .env serves both stacks during cutover.
 * Secrets are read here and nowhere else; never log the parsed object.
 */
const bool = (fallback: boolean) =>
  z.enum(["true", "false", "1", "0"]).optional().transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));
const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: int(3002, 1, 65535),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SWAGGER_ENABLED: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  DATABASE_POOL_MAX: int(20, 1, 200),
  RUN_MIGRATIONS_ON_START: bool(false),

  REDIS_URL: z.string().min(1, "REDIS_URL is required.").default("redis://localhost:6379"),

  JWT_SIGNING_KEY: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().default("Dhanvi"),
  JWT_AUDIENCE: z.string().default("Dhanvi.Web"),
  JWT_ACCESS_TOKEN_MINUTES: int(15, 1, 1440),
  JWT_REFRESH_TOKEN_DAYS: int(30, 1, 365),
  JWT_PASSWORD_RESET_MINUTES: int(30, 5, 1440),
  JWT_SECURE_COOKIES: bool(true),

  FRONTEND_ORIGIN: z.string().default("http://localhost:3000;http://localhost:3001"),

  GROUP_POLICY_MIN_MEMBERS: z.coerce.number().int().optional(),
  GROUP_POLICY_MAX_MEMBERS: z.coerce.number().int().optional(),

  DHANVI_SEED_ADMIN_ENABLED: bool(false),
  DHANVI_SEED_ADMIN_EMAIL: z.string().optional(),
  DHANVI_SEED_ADMIN_PASSWORD: z.string().optional(),

  PAYMENTS_RAZORPAY_ENABLED: bool(false),
  RAZORPAY_ENVIRONMENT: z.string().default("TEST"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOKS_ENABLED: bool(true),
  RAZORPAY_CHECKOUT_RETURN_BASE_URL: z.string().default(""),
  RAZORPAY_API_BASE_URL: z.string().url().default("https://api.razorpay.com/v1/"),

  PAYOUTS_PROVIDER: z.string().default("FAKE"),
  PAYOUTS_FAKE_OUTCOME: z.string().default("Success"),

  LEDGER_FEE_RECOGNITION: z.string().default("Deferred"),

  AUCTION_AUTOMATION_ENABLED: bool(true),
  AUCTION_GOING_ONCE_SECONDS: int(30, 1, 3600),
  AUCTION_GOING_TWICE_SECONDS: int(30, 1, 3600),
  AUCTION_FINAL_WARNING_SECONDS: int(30, 1, 3600),
  AUCTION_SWEEP_INTERVAL_SECONDS: int(15, 1, 3600),

  RECONCILIATION_SWEEP_ENABLED: bool(false),
  RECONCILIATION_SWEEP_INTERVAL_SECONDS: int(300, 30, 86400),

  WORKER_CONCURRENCY: int(4, 1, 64),
});

export type RawEnv = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): RawEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Report variable names only; values may be secrets.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}
