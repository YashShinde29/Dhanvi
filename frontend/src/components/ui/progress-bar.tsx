import type { ReactNode } from "react";

export function ProgressBar({ value, max, label, start, end, tone, size }: { value: number; max: number; label: string; start?: ReactNode; end?: ReactNode; tone?: "info" | "warning" | "indigo"; size?: "sm" }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`progress${size ? ` progress--${size}` : ""}`}>
      <div className="progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className={`progress__bar${tone ? ` progress__bar--${tone}` : ""}`} style={{ width: `${percent}%` }} />
      </div>
      {(start || end) && <div className="progress__meta"><span>{start}</span><span>{end}</span></div>}
    </div>
  );
}
