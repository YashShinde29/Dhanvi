"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { PlatformRole } from "@/types/auth";

export function ProtectedPage({ children, roles }: { children: React.ReactNode; roles?: PlatformRole[] }) {
  const auth = useAuth();
  const router = useRouter();
  const allowed = !roles || roles.some(role => auth.roles.includes(role));
  useEffect(() => {
    if (!auth.loading && !auth.authenticated) router.replace(`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`);
    else if (!auth.loading && !allowed) router.replace("/dashboard");
  }, [auth.loading, auth.authenticated, allowed, router]);
  if (auth.loading) return <PageSkeleton />;
  if (!auth.authenticated || !allowed) return null;
  return children;
}
