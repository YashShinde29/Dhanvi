"use client";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/ui/icons";
import { Brand } from "./brand";
import { pageTitleFor } from "./navigation";
import { UserMenu } from "./user-menu";

export function TopHeader({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <button type="button" className="btn btn--ghost btn--icon topbar__menu-btn" onClick={onMenu} aria-label="Open navigation" aria-controls="app-sidebar"><Icons.Menu size={22} /></button>
      <div className="topbar__context">
        <span className="topbar__brand"><Brand /></span>
        <span className="topbar__title">{pageTitleFor(pathname)}</span>
      </div>
      <UserMenu />
    </header>
  );
}
