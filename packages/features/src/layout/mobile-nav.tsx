"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@dhanvi/ui";
import { isActive, type ShellConfig } from "./navigation";
import type { CurrentUser } from "@dhanvi/types";

export function MobileNav({ config, user }: { config: ShellConfig; user: CurrentUser }) {
  const pathname = usePathname();
  const items = config.mobileNavigation(user);
  return (
    <nav className="mobile-nav" aria-label="Quick navigation">
      {items.map((item) => {
        const Icon = Icons[item.icon];
        if (item.external) return <a key={item.href} href={item.href} className="mobile-nav__link"><Icon size={22} />{item.label}</a>;
        return <Link key={item.href} href={item.href} className="mobile-nav__link" aria-current={isActive(item, pathname) ? "page" : undefined}><Icon size={22} />{item.label}</Link>;
      })}
    </nav>
  );
}
