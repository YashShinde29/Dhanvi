import type { CurrentUser, PlatformRole } from "@dhanvi/types";

/** Roles that may use the admin portal. The backend enforces the same policies independently. */
export const ADMIN_ROLES: PlatformRole[] = ["ADMIN", "SUPER_ADMIN"];
/** Roles that may use the member application. Administrators also hold USER. */
export const USER_APP_ROLES: PlatformRole[] = ["USER", "ORGANIZER"];

export const isAdminRole = (roles: PlatformRole[]) => roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
export const isOrganizerRole = (roles: PlatformRole[]) => roles.includes("ORGANIZER");
export const hasAnyRole = (roles: PlatformRole[], allowed: PlatformRole[]) => allowed.some((role) => roles.includes(role));

export function primaryRoleLabel(user: CurrentUser | null): string {
  if (!user) return "";
  if (user.roles.includes("SUPER_ADMIN")) return "Super admin";
  if (user.roles.includes("ADMIN")) return "Administrator";
  if (user.roles.includes("ORGANIZER")) return "Organizer";
  return "Member";
}
