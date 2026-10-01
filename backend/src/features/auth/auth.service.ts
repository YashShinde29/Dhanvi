import type { AuthConfig } from "../../config/auth.js";
import type { Database, Queryable, Tx } from "../../infra/database/db.js";
import type { Clock } from "../../types/common.types.js";
import { createOpaqueToken, hashPassword, newId, sha256HexUpper, verifyPassword } from "../../utils/crypto.js";
import { AuthenticationFailedError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors.js";
import { AuditActions, writeAuditLog } from "../audit/audit.service.js";
import { organizerRepository } from "../organizer/organizer.repository.js";
import { authRepository } from "./auth.repository.js";
import type { AuthenticationResponse, CurrentUserResponse, RegisteredUserResponse, UserRecord } from "./auth.types.js";
import { RoleNames } from "./auth.types.js";
import { isValidEmail, normalizeEmail, normalizePhone, validateNewPassword, validateProfile, validateRegistration } from "./auth.validation.js";
import type { TokenService } from "./token.service.js";

export interface RegisterInput { firstName: string; lastName: string; email: string; phoneNumber?: string | null; password: string }
export interface ProfileInput { firstName: string; lastName: string; phoneNumber?: string | null }

/** Optional delivery hook for reset tokens. No email/SMS provider is part of this migration; the default only logs. */
export type PasswordResetDelivery = (email: string, rawToken: string) => Promise<void>;

/** Port of IdentityService. Each mutation commits its user/token changes and audit rows in one transaction. */
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly config: AuthConfig,
    private readonly clock: Clock,
    private readonly deliverReset: PasswordResetDelivery,
  ) {}

  async register(input: RegisterInput, correlationId: string | null): Promise<RegisteredUserResponse> {
    validateRegistration(input, this.config.passwordPolicy);
    const normalizedEmail = normalizeEmail(input.email);
    if (await authRepository.emailExists(this.db, normalizedEmail)) throw new ConflictError("Email is already registered.");
    const now = this.clock.now();
    const user: UserRecord = {
      id: newId(), firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: input.email.trim(), normalizedEmail,
      phoneNumber: normalizePhone(input.phoneNumber), passwordHash: await hashPassword(input.password), emailVerified: false, phoneVerified: false,
      isActive: true, createdAt: now, updatedAt: now, lastLoginAt: null, roles: [RoleNames.User],
    };
    await this.db.transaction(async (tx) => {
      await authRepository.insertUser(tx, user);
      await authRepository.assignRole(tx, user.id, RoleNames.User, now);
      await writeAuditLog(tx, { actorUserId: user.id, action: AuditActions.UserRegistered, entityType: "User", entityId: user.id, timestamp: now, correlationId });
    }).catch((error: unknown) => {
      // Two concurrent registrations for one email: the unique index decides, the loser gets the same 409.
      if ((error as { code?: string }).code === "23505") throw new ConflictError("Email is already registered.");
      throw error;
    });
    return { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, roles: [RoleNames.User] };
  }

  async login(email: string, password: string, ip: string | null, correlationId: string | null): Promise<AuthenticationResponse> {
    const user = await authRepository.findByNormalizedEmail(this.db, normalizeEmail(email ?? ""));
    if (!user) {
      // Equalize timing with a real verification so unknown emails are not distinguishable.
      await verifyPassword(await hashPassword("DummyPassword@123"), password ?? "");
      throw new AuthenticationFailedError();
    }
    const verification = await verifyPassword(user.passwordHash, password ?? "");
    if (verification === "FAILED" || !user.isActive) throw new AuthenticationFailedError();
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      if (verification === "SUCCESS_REHASH_NEEDED") await authRepository.setPasswordHash(tx, user.id, await hashPassword(password), now);
      await authRepository.recordLogin(tx, user.id, now);
      const response = await this.issue(tx, user, ip, now);
      await writeAuditLog(tx, { actorUserId: user.id, action: AuditActions.UserLoginSuccess, entityType: "User", entityId: user.id, timestamp: now, correlationId });
      return response;
    });
  }

  /** Rotation: the presented token is revoked and replaced atomically; a reused (revoked) token is rejected. */
  async refresh(refreshToken: string, ip: string | null): Promise<AuthenticationResponse> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const stored = await authRepository.findRefreshToken(tx, sha256HexUpper(refreshToken), true);
      if (!stored || stored.RevokedAt !== null || stored.ExpiresAt.getTime() <= now.getTime()) throw new UnauthorizedError("Invalid or expired refresh token.");
      const user = await authRepository.findById(tx, stored.UserId);
      if (!user) throw new UnauthorizedError("Invalid or expired refresh token.");
      if (!user.isActive) throw new UnauthorizedError("The account is not active.");
      const raw = createOpaqueToken();
      const replacementId = newId();
      await authRepository.insertRefreshToken(tx, { id: replacementId, userId: user.id, tokenHash: sha256HexUpper(raw), expiresAt: this.tokens.refreshTokenExpiresAt(now), createdAt: now, createdByIp: ip });
      await authRepository.revokeRefreshToken(tx, stored.Id, now, ip, replacementId);
      return this.response(tx, user, raw, now);
    });
  }

  async logout(refreshToken: string, ip: string | null): Promise<void> {
    const stored = await authRepository.findRefreshToken(this.db, sha256HexUpper(refreshToken));
    if (stored) await authRepository.revokeRefreshToken(this.db, stored.Id, this.clock.now(), ip, null);
  }

  async currentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await authRepository.findById(this.db, userId);
    if (!user) throw new NotFoundError("User was not found.");
    return this.mapUser(this.db, user);
  }

  async updateProfile(userId: string, input: ProfileInput): Promise<CurrentUserResponse> {
    validateProfile(input);
    const user = await authRepository.findById(this.db, userId);
    if (!user) throw new NotFoundError("User was not found.");
    await authRepository.updateProfile(this.db, userId, input.firstName.trim(), input.lastName.trim(), normalizePhone(input.phoneNumber), this.clock.now());
    return this.currentUser(userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, correlationId: string | null): Promise<void> {
    validateNewPassword(newPassword, this.config.passwordPolicy);
    const user = await authRepository.findById(this.db, userId);
    if (!user) throw new NotFoundError("User was not found.");
    if ((await verifyPassword(user.passwordHash, currentPassword ?? "")) === "FAILED")
      throw new ValidationError({ currentPassword: ["Current password is incorrect."] });
    const now = this.clock.now();
    const hash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await authRepository.setPasswordHash(tx, userId, hash, now);
      await authRepository.revokeAllRefreshTokens(tx, userId, now);
      await writeAuditLog(tx, { actorUserId: userId, action: AuditActions.PasswordChanged, entityType: "User", entityId: userId, timestamp: now, correlationId });
    });
  }

  /** Always succeeds from the caller's view; only active, existing accounts receive a reset token. */
  async forgotPassword(email: string): Promise<void> {
    if (!isValidEmail(email)) return;
    const user = await authRepository.findByNormalizedEmail(this.db, normalizeEmail(email));
    if (!user || !user.isActive) return;
    const now = this.clock.now();
    const raw = createOpaqueToken();
    await authRepository.insertPasswordResetToken(this.db, { id: newId(), userId: user.id, tokenHash: sha256HexUpper(raw), expiresAt: this.tokens.passwordResetExpiresAt(now), createdAt: now });
    await this.deliverReset(user.email, raw);
  }

  async resetPassword(token: string, newPassword: string, correlationId: string | null): Promise<void> {
    validateNewPassword(newPassword, this.config.passwordPolicy);
    const now = this.clock.now();
    const hash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      const reset = await authRepository.findPasswordResetToken(tx, sha256HexUpper(token ?? ""));
      if (!reset || reset.UsedAt !== null || reset.ExpiresAt.getTime() <= now.getTime())
        throw new ValidationError({ token: ["Reset token is invalid or expired."] });
      await authRepository.markPasswordResetUsed(tx, reset.Id, now);
      await authRepository.setPasswordHash(tx, reset.UserId, hash, now);
      await authRepository.revokeAllRefreshTokens(tx, reset.UserId, now);
      await writeAuditLog(tx, { actorUserId: reset.UserId, action: AuditActions.PasswordReset, entityType: "User", entityId: reset.UserId, timestamp: now, correlationId });
    });
  }

  /** IIdentityService.VerifyPasswordAsync — step-up check before changing a payout account. */
  async verifyUserPassword(userId: string, password: string): Promise<void> {
    const user = await authRepository.findById(this.db, userId);
    if (!user || !user.isActive || !password || password.length > 256 || (await verifyPassword(user.passwordHash, password)) === "FAILED")
      throw new AuthenticationFailedError();
  }

  /** IdentitySeeder: ensures the four roles exist and, when enabled, an idempotent SUPER_ADMIN account. */
  async seed(): Promise<void> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      for (const name of [RoleNames.User, RoleNames.Organizer, RoleNames.Admin, RoleNames.SuperAdmin])
        await tx.execute(`INSERT INTO identity.roles ("Id","Name") VALUES ($1,$2) ON CONFLICT ("Name") DO NOTHING`, [newId(), name]);
      const seed = this.config.seedAdmin;
      if (!seed.enabled || !seed.email || !seed.password) return;
      const normalizedEmail = normalizeEmail(seed.email);
      let user = await authRepository.findByNormalizedEmail(tx, normalizedEmail);
      if (!user) {
        user = { id: newId(), firstName: "Dhanvi", lastName: "Administrator", email: seed.email.trim(), normalizedEmail, phoneNumber: null,
          passwordHash: await hashPassword(seed.password), emailVerified: false, phoneVerified: false, isActive: true, createdAt: now, updatedAt: now, lastLoginAt: null, roles: [] };
        await authRepository.insertUser(tx, user);
        await writeAuditLog(tx, { actorUserId: user.id, action: AuditActions.UserRegistered, entityType: "User", entityId: user.id, timestamp: now });
      }
      for (const role of [RoleNames.User, RoleNames.SuperAdmin])
        if (await authRepository.assignRole(tx, user.id, role, now))
          await writeAuditLog(tx, { actorUserId: user.id, action: AuditActions.UserRoleAssigned, entityType: "User", entityId: user.id, timestamp: now });
    });
  }

  private async issue(tx: Tx, user: UserRecord, ip: string | null, now: Date): Promise<AuthenticationResponse> {
    const raw = createOpaqueToken();
    await authRepository.insertRefreshToken(tx, { id: newId(), userId: user.id, tokenHash: sha256HexUpper(raw), expiresAt: this.tokens.refreshTokenExpiresAt(now), createdAt: now, createdByIp: ip });
    return this.response(tx, user, raw, now);
  }

  private async response(db: Queryable, user: UserRecord, rawRefresh: string, now: Date): Promise<AuthenticationResponse> {
    const current = await this.mapUser(db, user);
    return { accessToken: await this.tokens.createAccessToken(user, user.roles, now), refreshToken: rawRefresh, expiresIn: this.tokens.accessTokenExpiresInSeconds, user: current };
  }

  private async mapUser(db: Queryable, user: UserRecord): Promise<CurrentUserResponse> {
    return {
      id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phoneNumber: user.phoneNumber,
      emailVerified: user.emailVerified, phoneVerified: user.phoneVerified, roles: user.roles,
      organizerStatus: await organizerRepository.statusName(db, user.id), createdAt: user.createdAt,
    };
  }
}
