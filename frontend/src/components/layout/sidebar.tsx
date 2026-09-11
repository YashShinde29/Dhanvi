"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/ui/icons";
import { BrandMark } from "./brand";
import { isActive, navigationFor } from "./navigation";
import type { CurrentUser } from "@/types/auth";

export function Sidebar({ user, open, onClose }: { user: CurrentUser; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const sections = navigationFor(user);
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden />}
      <aside className={`sidebar${open ? " sidebar--open" : ""}`} aria-label="Primary navigation" id="app-sidebar">
        <Link href={user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN") ? "/admin" : user.roles.includes("ORGANIZER") ? "/organizer" : "/dashboard"} className="sidebar__brand" onClick={onClose}>
          <BrandMark size={30} />
          <span className="sidebar__label">Dhanvi</span>
        </Link>
        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div key={section.heading} className="sidebar__section">
              <div className="sidebar__heading">{section.heading}</div>
              {section.items.map((item) => {
                const Icon = Icons[item.icon];
                const active = isActive(item, pathname);
                return (
                  <Link key={item.href} href={item.href} className="sidebar__link" aria-current={active ? "page" : undefined} onClick={onClose} title={item.label}>
                    <Icon className="sidebar__icon" size={20} />
                    <span className="sidebar__label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">Business time zone · IST (Asia/Kolkata)</div>
      </aside>
    </>
  );
}
