export const RoleNames = { User: "USER", Organizer: "ORGANIZER", Admin: "ADMIN", SuperAdmin: "SUPER_ADMIN" } as const;
export type RoleName = (typeof RoleNames)[keyof typeof RoleNames];
export const ALL_ROLES: RoleName[] = ["USER", "ORGANIZER", "ADMIN", "SUPER_ADMIN"];

export interface UserRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  normalizedEmail: string;
  phoneNumber: string | null;
  passwordHash: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  roles: RoleName[];
}

export interface CurrentUserResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  roles: string[];
  organizerStatus: string;
  createdAt: Date;
}

export interface AuthenticationResponse { accessToken: string; refreshToken: string; expiresIn: number; user: CurrentUserResponse }
export interface RegisteredUserResponse { id: string; firstName: string; lastName: string; email: string; roles: string[] }

/** User directory projection used by groups (IGroupUserDirectory). Only active users are visible. */
export interface GroupUserInfo { id: string; name: string; email: string; phone: string | null; verified: boolean; memberSince: Date }
