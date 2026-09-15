"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authService } from "@dhanvi/api-client";
import type { CurrentUser, PlatformRole } from "@dhanvi/types";
import { hasAnyRole } from "./roles";

/**
 * Per-application authentication policy. Both apps share the backend session (HttpOnly cookies on the
 * same host), but each app decides which roles may use it and where to send people after sign-in.
 */
export interface AppAuthConfig {
  kind: "user" | "admin";
  /** Roles allowed to use this application at all. */
  allowedRoles: PlatformRole[];
  /** Where a permitted user lands after signing in (unless a safe returnUrl was requested). */
  homePath: string;
  loginPath: string;
  /** Rendered instead of protected content when the signed-in account may not use this application. */
  forbidden: ReactNode;
}

interface AuthContextValue {
  user: CurrentUser | null; loading: boolean; authenticated: boolean; roles: PlatformRole[];
  /** Whether the signed-in account may use this application. */
  permitted: boolean;
  app: AppAuthConfig;
  login(email: string, password: string): Promise<CurrentUser>;
  logout(): Promise<void>; refreshUser(): Promise<void>; setUser(user: CurrentUser | null): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ app, children }: { app: AppAuthConfig; children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshUser = useCallback(async () => {
    try { setUser(await authService.currentUser()); } catch { setUser(null); }
  }, []);

  useEffect(() => {
    let active = true;
    authService.currentUser()
      .then(currentUser => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, loading, authenticated: user !== null, roles: user?.roles ?? [], setUser, app,
    permitted: user !== null && hasAnyRole(user.roles, app.allowedRoles),
    login: async (email, password) => { const response = await authService.login(email, password); setUser(response.user); return response.user; },
    logout: async () => { try { await authService.logout(); } finally { setUser(null); } },
    refreshUser,
  }), [user, loading, refreshUser, app]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}

/** Only same-origin paths are honoured as post-login destinations. */
export function safeReturnUrl(returnUrl: string | null, fallback: string): string {
  return returnUrl?.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : fallback;
}
