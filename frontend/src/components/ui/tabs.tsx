"use client";
import type { ReactNode } from "react";

export interface TabItem { id: string; label: string; count?: number; alert?: boolean; icon?: ReactNode }

export function Tabs({ items, value, onChange, label = "Sections" }: { items: TabItem[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
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
  );
}

export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="stack stack--lg">{children}</div>;
}
