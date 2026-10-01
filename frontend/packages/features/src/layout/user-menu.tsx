"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, primaryRoleLabel } from "@dhanvi/auth";
import { Avatar, Icons } from "@dhanvi/ui";
import type { ShellConfig } from "./navigation";

export function UserMenu({ config }: { config: ShellConfig }) {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) { if (!ref.current?.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const user = auth.user;
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`.trim();
  async function logout() {
    setOpen(false);
    await auth.logout();
    router.push(config.loginPath);
  }
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu__trigger" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${name}`}>
        <Avatar name={name} />
        <span className="user-menu__meta">
          <span className="user-menu__name">{name}</span>
          <span className="user-menu__role">{primaryRoleLabel(user)}</span>
        </span>
        <Icons.ChevronDown size={16} style={{ color: "var(--color-text-muted)" }} />
      </button>
      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__header">
            <div className="text-strong text-sm">{name}</div>
            <div className="text-xs text-muted" style={{ overflowWrap: "anywhere" }}>{user.email}</div>
          </div>
          {config.menuItems(user).map((item) => {
            const Icon = Icons[item.icon];
            return item.external
              ? <a key={item.href} href={item.href} className="user-menu__item" role="menuitem" onClick={() => setOpen(false)}><Icon size={16} /> {item.label}</a>
              : <Link key={item.href} href={item.href} className="user-menu__item" role="menuitem" onClick={() => setOpen(false)}><Icon size={16} /> {item.label}</Link>;
          })}
          <button type="button" className="user-menu__item user-menu__item--danger" role="menuitem" onClick={logout}><Icons.LogOut size={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}
