import type { ReactNode } from "react";

export interface ActivityItem { id: string; icon?: ReactNode; title: ReactNode; description?: ReactNode; time?: string }

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <div className="activity">
      {items.map((item) => (
        <div key={item.id} className="activity__item">
          <span className="activity__icon">{item.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div className="activity__title">{item.title}</div>
            {item.description && <div className="activity__desc">{item.description}</div>}
          </div>
          {item.time && <span className="activity__time">{item.time}</span>}
        </div>
      ))}
    </div>
  );
}
