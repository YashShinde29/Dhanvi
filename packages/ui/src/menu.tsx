"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icons } from "./icons";

export interface MenuAction { id: string; label: ReactNode; onSelect?: () => void; href?: string; danger?: boolean; disabled?: boolean; icon?: ReactNode }

/**
 * The "•••" overflow for rare, secondary or destructive actions. Destructive items sit after a divider so they are
 * never adjacent to the page's primary action. Renders nothing when there are no items.
 */
export function OverflowMenu({ items, label = "More actions", size = "md" }: { items: MenuAction[]; label?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) { if (!ref.current?.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (items.length === 0) return null;
  const safe = items.filter((i) => !i.danger), danger = items.filter((i) => i.danger);
  const render = (item: MenuAction) => {
    const className = `menu__item${item.danger ? " menu__item--danger" : ""}`;
    const content = <>{item.icon}{item.label}</>;
    if (item.href && !item.disabled) return <Link key={item.id} href={item.href} role="menuitem" className={className} onClick={() => setOpen(false)}>{content}</Link>;
    return <button key={item.id} type="button" role="menuitem" className={className} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect?.(); }}>{content}</button>;
  };
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`btn btn--ghost btn--icon${size === "sm" ? " btn--sm" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((v) => !v)}>
        <Icons.More size={18} />
      </button>
      {open && (
        <div className="menu__panel" role="menu" id={id}>
          {safe.map(render)}
          {safe.length > 0 && danger.length > 0 && <div className="menu__divider" role="separator" />}
          {danger.map(render)}
        </div>
      )}
    </div>
  );
}
