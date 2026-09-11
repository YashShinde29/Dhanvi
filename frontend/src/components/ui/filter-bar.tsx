"use client";
import type { ReactNode } from "react";

export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="filter-bar" role="search">
      {children}
      {actions && <div className="filter-bar__actions">{actions}</div>}
    </div>
  );
}

export interface ChipOption { value: string; label: string }

export function ChipGroup({ options, value, onChange, label }: { options: ChipOption[]; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map((option) => <button key={option.value} type="button" className="chip" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  );
}
