import { pino } from "pino";
import { REDACT } from "../app.js";
import type { AppConfig } from "../config/index.js";

/** Structured JSON logs (Pino), redacted. Pretty output only for local development terminals. */
export function createLogger(config: Pick<AppConfig, "logLevel" | "env">, name: string) {
  return pino({
    name, level: config.logLevel, redact: { paths: REDACT, censor: "[REDACTED]" },
    ...(config.env === "development" && process.stdout.isTTY ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
  });
}
