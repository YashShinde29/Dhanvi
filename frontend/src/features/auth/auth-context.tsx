"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "@/services/auth.service";
import type { CurrentUser, PlatformRole } from "@/types/auth";

interface AuthContextValue {
  user: CurrentUser | null; loading: boolean; authenticated: boolean; roles: PlatformRole[];
  login(email: string, password: string): Promise<CurrentUser>;
  logout(): Promise<void>; refreshUser(): Promise<void>; setUser(user: CurrentUser | null): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
    user, loading, authenticated: user !== null, roles: user?.roles ?? [], setUser,
    login: async (email, password) => { const response = await authService.login(email, password); setUser(response.user); return response.user; },
    logout: async () => { try { await authService.logout(); } finally { setUser(null); } },
    refreshUser,
  }), [user, loading, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}

export function postLoginPath(roles: PlatformRole[]): string {
  return roles.includes("ADMIN") || roles.includes("SUPER_ADMIN") ? "/admin" : "/dashboard";
}
