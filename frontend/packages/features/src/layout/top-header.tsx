"use client";
import { usePathname } from "next/navigation";
import { Icons, Brand } from "@dhanvi/ui";
import type { ShellConfig } from "./navigation";
import { UserMenu } from "./user-menu";

export function TopHeader({ config, onMenu }: { config: ShellConfig; onMenu: () => void }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <button type="button" className="btn btn--ghost btn--icon topbar__menu-btn" onClick={onMenu} aria-label="Open navigation" aria-controls="app-sidebar"><Icons.Menu size={22} /></button>
      <div className="topbar__context">
        <span className="topbar__brand"><Brand label={config.brand.label} /></span>
        <span className="topbar__title">{config.pageTitle(pathname)}</span>
      </div>
      <UserMenu config={config} />
    </header>
  );
}
