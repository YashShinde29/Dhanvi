"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import type { GroupScope } from "@/services/group.service";

export function Guard({ scope, children }: { scope: GroupScope; children: React.ReactNode }) {
  if (scope === "public") return children;
  return (
    <ProtectedPage roles={scope === "admin" ? ["ADMIN", "SUPER_ADMIN"] : scope === "organizer" ? ["ORGANIZER"] : undefined}>
      {children}
    </ProtectedPage>
  );
}

/** Where a group should open from a given scope's listing. */
export function groupHref(scope: GroupScope, id: string): string {
  return scope === "organizer" ? `/organizer/groups/${id}` : scope === "admin" ? `/admin/groups/${id}` : `/groups/${id}`;
}

export const managementScope = (scope: GroupScope): scope is "organizer" | "admin" => scope === "organizer" || scope === "admin";
