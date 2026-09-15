"use client";
import { ProtectedPage } from "@dhanvi/auth";
import type { GroupScope } from "@dhanvi/api-client";

export function Guard({ scope, children }: { scope: GroupScope; children: React.ReactNode }) {
  if (scope === "public") return children;
  return (
    <ProtectedPage roles={scope === "admin" ? ["ADMIN", "SUPER_ADMIN"] : scope === "organizer" ? ["ORGANIZER"] : undefined}>
      {children}
    </ProtectedPage>
  );
}

/** URL prefix for management routes: organizer pages live under /organizer in the member app; admin pages are unprefixed in the admin app. */
export const managePrefix = (scope: GroupScope): string => (scope === "organizer" ? "/organizer" : "");

/** Where a group should open from a given scope's listing. */
export function groupHref(scope: GroupScope, id: string): string {
  return `${managePrefix(scope)}/groups/${id}`;
}

export const managementScope = (scope: GroupScope): scope is "organizer" | "admin" => scope === "organizer" || scope === "admin";
