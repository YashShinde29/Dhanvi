"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@dhanvi/ui";
import { isActive, type ShellConfig } from "./navigation";
import type { CurrentUser } from "@dhanvi/types";

/**
 * Bottom navigation for phones: at most four primary destinations plus "More", which opens the full navigation drawer
 * (every remaining section, organizer tools, the admin cross-link and sign-out live there).
 */
export function MobileNav({ config, user, onMore, menuOpen }: { config: ShellConfig; user: CurrentUser; onMore: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  const items = config.mobileNavigation(user).slice(0, 4);
  return (
    <nav className="mobile-nav" aria-label="Quick navigation">
      {items.map((item) => {
        const Icon = Icons[item.icon];
        const label = item.shortLabel ?? item.label;
        if (item.external) return <a key={item.href} href={item.href} className="mobile-nav__link" aria-label={item.label}><Icon size={22} /><span>{label}</span></a>;
        return <Link key={item.href} href={item.href} className="mobile-nav__link" aria-current={isActive(item, pathname) ? "page" : undefined} aria-label={item.label}><Icon size={22} /><span>{label}</span></Link>;
      })}
      <button type="button" className="mobile-nav__link" onClick={onMore} aria-expanded={menuOpen} aria-controls="app-sidebar" aria-label="More navigation"><Icons.Menu size={22} /><span>More</span></button>
    </nav>
  );
}
