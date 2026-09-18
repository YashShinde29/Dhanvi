"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface TabItem { id: string; label: string; count?: number; alert?: boolean; icon?: ReactNode }

/**
 * Horizontal tab strip. On phones it scrolls sideways: edge fades signal hidden tabs and the selected tab is kept in
 * view, so a group page with ten sections never shrinks its tabs into unreadable slivers.
 */
export function Tabs({ items, value, onChange, label = "Sections" }: { items: TabItem[]; value: string; onChange: (id: string) => void; label?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = listRef.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFade({ start: el.scrollLeft > 4, end: max > 4 && el.scrollLeft < max - 4 });
  }, []);
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => { el.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [measure, items.length]);
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div className="tabs-wrap" data-fade-start={fade.start || undefined} data-fade-end={fade.end || undefined}>
      <div className="tabs" role="tablist" aria-label={label} ref={listRef}>
        {items.map((item) => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={value === item.id} aria-controls={`panel-${item.id}`} className="tab" onClick={() => onChange(item.id)} tabIndex={value === item.id ? 0 : -1}
            onKeyDown={(e) => {
              const index = items.findIndex((i) => i.id === value);
              if (e.key === "ArrowRight") onChange(items[(index + 1) % items.length]!.id);
              if (e.key === "ArrowLeft") onChange(items[(index - 1 + items.length) % items.length]!.id);
            }}>
            {item.icon}{item.label}
            {item.count !== undefined && <span className={`tab__count${item.alert && item.count > 0 ? " tab__count--alert" : ""}`}>{item.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="stack stack--lg">{children}</div>;
}
