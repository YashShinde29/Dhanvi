import type { Queryable } from "../../infra/database/db.js";
import type { GroupUserInfo, RoleName, UserRecord } from "./auth.types.js";

type UserRow = {
  Id: string; FirstName: string; LastName: string; Email: string; NormalizedEmail: string; PhoneNumber: string | null; PasswordHash: string;
  EmailVerified: boolean; PhoneVerified: boolean; IsActive: boolean; CreatedAt: Date; UpdatedAt: Date; LastLoginAt: Date | null; Roles: string[] | null;
};

const SELECT_USER = `
  SELECT u.*, COALESCE((SELECT array_agg(r."Name" ORDER BY r."Name" COLLATE "C") FROM identity.user_roles ur JOIN identity.roles r ON r."Id" = ur."RoleId" WHERE ur."UserId" = u."Id"), '{}') AS "Roles"
  FROM identity.users u`;

const map = (r: UserRow): UserRecord => ({
  id: r.Id, firstName: r.FirstName, lastName: r.LastName, email: r.Email, normalizedEmail: r.NormalizedEmail, phoneNumber: r.PhoneNumber,
  passwordHash: r.PasswordHash, emailVerified: r.EmailVerified, phoneVerified: r.PhoneVerified, isActive: r.IsActive,
  createdAt: r.CreatedAt, updatedAt: r.UpdatedAt, lastLoginAt: r.LastLoginAt, roles: (r.Roles ?? []) as RoleName[],
});

export const authRepository = {
  async findById(db: Queryable, id: string, lock = false): Promise<UserRecord | null> {
    const row = await db.maybeOne<UserRow>(`${SELECT_USER} WHERE u."Id" = $1${lock ? " FOR UPDATE OF u" : ""}`, [id]);
    return row && map(row);
  },
  async findByNormalizedEmail(db: Queryable, normalizedEmail: string): Promise<UserRecord | null> {
    const row = await db.maybeOne<UserRow>(`${SELECT_USER} WHERE u."NormalizedEmail" = $1`, [normalizedEmail]);
    return row && map(row);
  },
  async emailExists(db: Queryable, normalizedEmail: string): Promise<boolean> {
    return (await db.maybeOne(`SELECT 1 FROM identity.users WHERE "NormalizedEmail" = $1`, [normalizedEmail])) !== null;
  },
  async roleId(db: Queryable, name: RoleName): Promise<string> {
    return (await db.one<{ Id: string }>(`SELECT "Id" FROM identity.roles WHERE "Name" = $1`, [name])).Id;
  },
  async insertUser(db: Queryable, u: UserRecord): Promise<void> {
    await db.execute(`INSERT INTO identity.users ("Id","FirstName","LastName","Email","NormalizedEmail","PhoneNumber","PasswordHash","EmailVerified","PhoneVerified","IsActive","CreatedAt","UpdatedAt","LastLoginAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [u.id, u.firstName, u.lastName, u.email, u.normalizedEmail, u.phoneNumber, u.passwordHash, u.emailVerified, u.phoneVerified, u.isActive, u.createdAt, u.updatedAt, u.lastLoginAt]);
  },
  /** Idempotent role grant (User.AssignRole ignores an existing role). Returns true when the role was added. */
  async assignRole(db: Queryable, userId: string, role: RoleName, at: Date): Promise<boolean> {
    const count = await db.execute(`INSERT INTO identity.user_roles ("UserId","RoleId","AssignedAt") SELECT $1, r."Id", $3 FROM identity.roles r WHERE r."Name" = $2 ON CONFLICT DO NOTHING`, [userId, role, at]);
    return count > 0;
  },
  async setPasswordHash(db: Queryable, userId: string, hash: string, now: Date): Promise<void> {
    await db.execute(`UPDATE identity.users SET "PasswordHash" = $2, "UpdatedAt" = $3 WHERE "Id" = $1`, [userId, hash, now]);
  },
  async recordLogin(db: Queryable, userId: string, now: Date): Promise<void> {
    await db.execute(`UPDATE identity.users SET "LastLoginAt" = $2, "UpdatedAt" = $2 WHERE "Id" = $1`, [userId, now]);
  },
  async updateProfile(db: Queryable, userId: string, firstName: string, lastName: string, phone: string | null, now: Date): Promise<void> {
    await db.execute(`UPDATE identity.users SET "FirstName" = $2, "LastName" = $3, "PhoneNumber" = $4, "UpdatedAt" = $5 WHERE "Id" = $1`, [userId, firstName, lastName, phone, now]);
  },
  async insertRefreshToken(db: Queryable, t: { id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date; createdByIp: string | null }): Promise<void> {
    await db.execute(`INSERT INTO identity.refresh_tokens ("Id","UserId","TokenHash","ExpiresAt","CreatedAt","CreatedByIp") VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.id, t.userId, t.tokenHash, t.expiresAt, t.createdAt, t.createdByIp]);
  },
  async findRefreshToken(db: Queryable, tokenHash: string, lock = false) {
    return db.maybeOne<{ Id: string; UserId: string; ExpiresAt: Date; RevokedAt: Date | null }>(
      `SELECT "Id","UserId","ExpiresAt","RevokedAt" FROM identity.refresh_tokens WHERE "TokenHash" = $1${lock ? " FOR UPDATE" : ""}`, [tokenHash]);
  },
  /** RefreshToken.Revoke: first revocation wins; later calls are no-ops. */
  async revokeRefreshToken(db: Queryable, id: string, now: Date, ip: string | null, replacementId: string | null): Promise<number> {
    return db.execute(`UPDATE identity.refresh_tokens SET "RevokedAt" = $2, "RevokedByIp" = $3, "ReplacedByTokenId" = $4 WHERE "Id" = $1 AND "RevokedAt" IS NULL`, [id, now, ip, replacementId]);
  },
  async revokeAllRefreshTokens(db: Queryable, userId: string, now: Date): Promise<void> {
    await db.execute(`UPDATE identity.refresh_tokens SET "RevokedAt" = $2, "RevokedByIp" = NULL, "ReplacedByTokenId" = NULL WHERE "UserId" = $1 AND "RevokedAt" IS NULL`, [userId, now]);
  },
  async insertPasswordResetToken(db: Queryable, t: { id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date }): Promise<void> {
    await db.execute(`INSERT INTO identity.password_reset_tokens ("Id","UserId","TokenHash","ExpiresAt","CreatedAt") VALUES ($1,$2,$3,$4,$5)`, [t.id, t.userId, t.tokenHash, t.expiresAt, t.createdAt]);
  },
  async findPasswordResetToken(db: Queryable, tokenHash: string) {
    return db.maybeOne<{ Id: string; UserId: string; ExpiresAt: Date; UsedAt: Date | null }>(
      `SELECT "Id","UserId","ExpiresAt","UsedAt" FROM identity.password_reset_tokens WHERE "TokenHash" = $1 FOR UPDATE`, [tokenHash]);
  },
  async markPasswordResetUsed(db: Queryable, id: string, now: Date): Promise<void> {
    await db.execute(`UPDATE identity.password_reset_tokens SET "UsedAt" = $2 WHERE "Id" = $1`, [id, now]);
  },
  /** IGroupUserDirectory.FindAsync — active users only. */
  async directory(db: Queryable, userId: string): Promise<GroupUserInfo | null> {
    const r = await db.maybeOne<{ Id: string; FirstName: string; LastName: string; Email: string; PhoneNumber: string | null; EmailVerified: boolean; CreatedAt: Date }>(
      `SELECT "Id","FirstName","LastName","Email","PhoneNumber","EmailVerified","CreatedAt" FROM identity.users WHERE "Id" = $1 AND "IsActive"`, [userId]);
    return r && { id: r.Id, name: `${r.FirstName} ${r.LastName}`, email: r.Email, phone: r.PhoneNumber, verified: r.EmailVerified, memberSince: r.CreatedAt };
  },
  async directoryMany(db: Queryable, userIds: string[]): Promise<Map<string, GroupUserInfo>> {
    if (userIds.length === 0) return new Map();
    const rows = await db.query<{ Id: string; FirstName: string; LastName: string; Email: string; PhoneNumber: string | null; EmailVerified: boolean; CreatedAt: Date }>(
      `SELECT "Id","FirstName","LastName","Email","PhoneNumber","EmailVerified","CreatedAt" FROM identity.users WHERE "Id" = ANY($1::uuid[]) AND "IsActive"`, [[...new Set(userIds)]]);
    return new Map(rows.map((r) => [r.Id, { id: r.Id, name: `${r.FirstName} ${r.LastName}`, email: r.Email, phone: r.PhoneNumber, verified: r.EmailVerified, memberSince: r.CreatedAt }]));
  },
};
