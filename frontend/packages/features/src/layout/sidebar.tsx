"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons, BrandMark } from "@dhanvi/ui";
import type { CurrentUser } from "@dhanvi/types";
import { isActive, type NavItem, type ShellConfig } from "./navigation";

function NavLink({ item, pathname, onClose }: { item: NavItem; pathname: string; onClose: () => void }) {
  const Icon = Icons[item.icon];
  const active = isActive(item, pathname);
  const content = <><Icon className="sidebar__icon" size={20} /><span className="sidebar__label">{item.label}</span></>;
  if (item.external) return <a href={item.href} className="sidebar__link" title={item.label} onClick={onClose}>{content}</a>;
  return <Link href={item.href} className="sidebar__link" aria-current={active ? "page" : undefined} onClick={onClose} title={item.label}>{content}</Link>;
}

export function Sidebar({ config, user, open, onClose }: { config: ShellConfig; user: CurrentUser; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const sections = config.navigation(user);
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden />}
      <aside className={`sidebar${open ? " sidebar--open" : ""}`} aria-label="Primary navigation" id="app-sidebar">
        <div className="sidebar__brand">
          <Link href={config.homeHref(user)} className="sidebar__brand-link" onClick={onClose}>
            <BrandMark size={30} />
            <span className="sidebar__label">{config.brand.label}{config.brand.subtitle && <span className="sidebar__brand-subtitle">{config.brand.subtitle}</span>}</span>
          </Link>
          <button type="button" className="btn btn--ghost btn--icon sidebar__close" onClick={onClose} aria-label="Close navigation"><Icons.X size={20} /></button>
        </div>
        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div key={section.heading} className="sidebar__section">
              <div className="sidebar__heading">{section.heading}</div>
              {section.items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onClose={onClose} />)}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">Business time zone · IST (Asia/Kolkata)</div>
      </aside>
    </>
  );
}
