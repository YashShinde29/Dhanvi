export type PlatformRole = "USER" | "ORGANIZER" | "ADMIN" | "SUPER_ADMIN";
export type OrganizerStatus = "NOT_APPLIED" | "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";

export interface CurrentUser {
  id: string; firstName: string; lastName: string; email: string; phoneNumber: string | null;
  emailVerified: boolean; phoneVerified: boolean; roles: PlatformRole[];
  organizerStatus: OrganizerStatus; createdAt: string;
}

export interface AuthenticationResponse { accessToken: string; refreshToken: string; expiresIn: number; user: CurrentUser }

