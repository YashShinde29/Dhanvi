"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import type { GroupScope } from "@/services/group.service";
export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
export const label = (s: string) => s.replaceAll("_", " ");
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Request failed. Please try again.";
export function Guard({
  scope,
  children,
}: {
  scope: GroupScope;
  children: React.ReactNode;
}) {
  if (scope === "public") return children;
  return (
    <ProtectedPage
      roles={
        scope === "admin"
          ? ["ADMIN", "SUPER_ADMIN"]
          : scope === "organizer"
            ? ["ORGANIZER"]
            : undefined
      }
    >
      {children}
    </ProtectedPage>
  );
}
