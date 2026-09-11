"use client";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { MobileNav } from "./mobile-nav";
import { PublicShell } from "./public-shell";
import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";

const PUBLIC_ONLY = ["/", "/login", "/register", "/forgot-password", "/reset-password"];

/**
 * Chooses the shell for the current route:
 * - marketing/auth routes always use the public shell
 * - signed-in users get the sidebar application shell
 * - anonymous visitors browsing groups get the public shell
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const publicRoute = PUBLIC_ONLY.includes(pathname);
  if (publicRoute || (!auth.loading && !auth.authenticated) || !auth.user) {
    if (auth.loading && !publicRoute) return <div className="shell"><div className="page"><div className="skeleton skeleton--title" style={{ width: 220 }} /></div></div>;
    return <PublicShell>{publicRoute ? children : <div className="page">{children}</div>}</PublicShell>;
  }
  return (
    <div className="app">
      <Sidebar user={auth.user} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="app__main">
        <TopHeader onMenu={() => setMenuOpen(true)} />
        <main className="page" id="main">{children}</main>
        <MobileNav user={auth.user} />
      </div>
    </div>
  );
}
