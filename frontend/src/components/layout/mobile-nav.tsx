"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/ui/icons";
import { isActive, mobileNavigationFor } from "./navigation";
import type { CurrentUser } from "@/types/auth";

export function MobileNav({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const items = mobileNavigationFor(user);
  return (
    <nav className="mobile-nav" aria-label="Quick navigation">
      {items.map((item) => {
        const Icon = Icons[item.icon];
        return <Link key={item.href} href={item.href} className="mobile-nav__link" aria-current={isActive(item, pathname) ? "page" : undefined}><Icon size={22} />{item.label}</Link>;
      })}
    </nav>
  );
}
