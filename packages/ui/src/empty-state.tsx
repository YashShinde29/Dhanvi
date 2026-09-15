import type { ReactNode } from "react";
import { Icons } from "./icons";

export function EmptyState({ title, description, action, icon, compact }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? " empty--compact" : ""}`}>
      <div className="empty__icon">{icon ?? <Icons.Inbox size={24} />}</div>
      <div className="empty__title">{title}</div>
      {description && <p className="empty__desc">{description}</p>}
      {action && <div className="row" style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
