import { jwtVerify, SignJWT } from "jose";
import type { AuthConfig } from "../../config/auth.js";
import type { RoleName } from "./auth.types.js";

/**
 * JWT access tokens with the exact claim set the .NET TokenService emitted (verified against a live .NET token):
 *   sub, email, <ClaimTypes.NameIdentifier URI>, <ClaimTypes.Role URI> (string or array), nbf, exp, iss, aud — no iat.
 * Tokens issued by either stack validate on the other during cutover (same key, issuer, audience).
 */
export const NAME_IDENTIFIER_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";
export const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const CLOCK_SKEW_SECONDS = 30;

export interface AccessPrincipal { userId: string; roles: string[] }

export class TokenService {
  private readonly key: Uint8Array;
  constructor(private readonly config: AuthConfig) {
    this.key = new TextEncoder().encode(config.signingKey);
  }

  get accessTokenExpiresInSeconds(): number { return this.config.accessTokenMinutes * 60; }
  refreshTokenExpiresAt(now: Date): Date { return new Date(now.getTime() + this.config.refreshTokenDays * 86_400_000); }
  passwordResetExpiresAt(now: Date): Date { return new Date(now.getTime() + this.config.passwordResetMinutes * 60_000); }

  async createAccessToken(user: { id: string; email: string }, roles: RoleName[], now: Date): Promise<string> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return new SignJWT({
      sub: user.id,
      email: user.email,
      [NAME_IDENTIFIER_CLAIM]: user.id,
      ...(roles.length === 0 ? {} : { [ROLE_CLAIM]: roles.length === 1 ? roles[0] : roles }),
      nbf: nowSeconds,
      exp: nowSeconds + this.config.accessTokenMinutes * 60,
      iss: this.config.issuer,
      aud: this.config.audience,
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(this.key);
  }

  /** Validates signature, issuer, audience and lifetime (30 s skew, as ClockSkew in Program.cs). */
  async verify(token: string): Promise<AccessPrincipal | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: this.config.issuer, audience: this.config.audience, clockTolerance: CLOCK_SKEW_SECONDS });
      if (typeof payload.exp !== "number") return null;
      const id = payload[NAME_IDENTIFIER_CLAIM] ?? payload.nameid ?? payload.sub;
      if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
      const rawRoles = payload[ROLE_CLAIM] ?? payload.role;
      const roles = Array.isArray(rawRoles) ? rawRoles.filter((r): r is string => typeof r === "string") : typeof rawRoles === "string" ? [rawRoles] : [];
      return { userId: id.toLowerCase(), roles };
    } catch {
      return null;
    }
  }
}
