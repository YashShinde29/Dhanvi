"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { PageSkeleton } from "@dhanvi/ui";
import type { PlatformRole } from "@dhanvi/types";

/**
 * Route-level guard used by every non-public page in both apps.
 * 1. Anonymous visitors go to this app's login page with a safe returnUrl.
 * 2. Accounts outside the app's allowed roles see the app's forbidden screen — never the page.
 * 3. Page-level roles (e.g. ORGANIZER) fall back to the app home.
 * Nothing renders until the session check has completed; the backend still authorizes every API call.
 */
export function ProtectedPage({ children, roles }: { children: React.ReactNode; roles?: PlatformRole[] }) {
  const auth = useAuth();
  const router = useRouter();
  const pageAllowed = !roles || roles.some(role => auth.roles.includes(role));
  const allowed = auth.permitted && pageAllowed;
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.authenticated) router.replace(`${auth.app.loginPath}?returnUrl=${encodeURIComponent(location.pathname + location.search)}`);
    else if (auth.permitted && !pageAllowed) router.replace(auth.app.homePath);
  }, [auth.loading, auth.authenticated, auth.permitted, pageAllowed, auth.app.loginPath, auth.app.homePath, router]);
  if (auth.loading) return <PageSkeleton />;
  if (auth.authenticated && !auth.permitted) return auth.app.forbidden;
  if (!allowed) return null;
  return children;
}
