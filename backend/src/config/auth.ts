import type { RawEnv } from "./env.js";

export interface PasswordPolicy {
  minimumLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialCharacter: boolean;
}

export interface AuthConfig {
  signingKey: string;
  issuer: string;
  audience: string;
  accessTokenMinutes: number;
  refreshTokenDays: number;
  passwordResetMinutes: number;
  secureCookies: boolean;
  passwordPolicy: PasswordPolicy;
  seedAdmin: { enabled: boolean; email?: string; password?: string };
}

export function authConfig(env: RawEnv): AuthConfig {
  const signingKey = env.JWT_SIGNING_KEY ?? env.JWT_SECRET ?? "";
  // Same rule as the .NET JwtOptions validation: HS256 key of at least 32 characters.
  if (signingKey.length < 32) throw new Error("JWT_SIGNING_KEY must contain at least 32 characters.");
  if (env.DHANVI_SEED_ADMIN_ENABLED && (!env.DHANVI_SEED_ADMIN_EMAIL?.trim() || !env.DHANVI_SEED_ADMIN_PASSWORD?.trim()))
    throw new Error("Admin seeding is enabled but DHANVI_SEED_ADMIN_EMAIL or DHANVI_SEED_ADMIN_PASSWORD is missing.");
  return {
    signingKey,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    accessTokenMinutes: env.JWT_ACCESS_TOKEN_MINUTES,
    refreshTokenDays: env.JWT_REFRESH_TOKEN_DAYS,
    passwordResetMinutes: env.JWT_PASSWORD_RESET_MINUTES,
    secureCookies: env.JWT_SECURE_COOKIES,
    passwordPolicy: { minimumLength: 8, requireUppercase: true, requireLowercase: true, requireDigit: true, requireSpecialCharacter: true },
    seedAdmin: { enabled: env.DHANVI_SEED_ADMIN_ENABLED, email: env.DHANVI_SEED_ADMIN_EMAIL, password: env.DHANVI_SEED_ADMIN_PASSWORD },
  };
}
