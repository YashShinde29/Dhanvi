"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@dhanvi/auth";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";
import type { ShellConfig } from "./navigation";

/**
 * Chooses the shell for the current route:
 * - public routes always use the app's public shell
 * - signed-in, permitted users get the sidebar application shell
 * - anonymous visitors get the public shell around the page (ProtectedPage handles redirects)
 */
export function AppShell({ config, children }: { config: ShellConfig; children: ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();
  // The drawer state is keyed by pathname: navigating closes it without an effect; Escape closes it; page scroll locks while open.
  const [menu, setMenu] = useState<{ open: boolean; path: string }>({ open: false, path: pathname });
  const menuOpen = menu.open && menu.path === pathname;
  const setMenuOpen = (next: boolean | ((open: boolean) => boolean)) => setMenu((m) => ({ open: typeof next === "function" ? next(m.open && m.path === pathname) : next, path: pathname }));
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu((m) => ({ ...m, open: false })); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  const publicRoute = config.publicRoutes.includes(pathname);
  if (publicRoute || (!auth.loading && !auth.authenticated) || !auth.user || !auth.permitted) {
    if (auth.loading && !publicRoute) return <div className="shell"><div className="page"><div className="skeleton skeleton--title" style={{ width: 220 }} /></div></div>;
    return config.publicShell(publicRoute ? children : <div className="page">{children}</div>);
  }
  return (
    <div className="app">
      <Sidebar config={config} user={auth.user} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="app__main">
        <TopHeader config={config} onMenu={() => setMenuOpen(true)} />
        <main className="page" id="main">{children}</main>
        <MobileNav config={config} user={auth.user} onMore={() => setMenuOpen((v) => !v)} menuOpen={menuOpen} />
      </div>
    </div>
  );
}
