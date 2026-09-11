import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";

interface StatCardProps { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; compact?: boolean; accent?: boolean; loading?: boolean }

export function StatCard({ label, value, hint, icon, compact, accent, loading }: StatCardProps) {
  return (
    <div className={["stat", compact ? "stat--compact" : "", accent ? "stat--accent" : ""].filter(Boolean).join(" ")}>
      {icon && <div className="stat__icon">{icon}</div>}
      <div className="stat__label">{label}</div>
      {loading ? <div className="skeleton skeleton--title" style={{ height: 28, width: "60%" }} /> : <div className="stat__value">{value}</div>}
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function FinancialStatCard({ label, amount, hint, icon, compact, loading }: { label: string; amount: number | null | undefined; hint?: ReactNode; icon?: ReactNode; compact?: boolean; loading?: boolean }) {
  return (
    <div className={`stat${compact ? " stat--compact" : ""}`}>
      {icon && <div className="stat__icon">{icon}</div>}
      <div className="stat__label">{label}</div>
      {loading ? <div className="skeleton skeleton--title" style={{ height: 28, width: "60%" }} /> : <div className="stat__value stat__value--money amount">{formatMoney(amount)}</div>}
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}
