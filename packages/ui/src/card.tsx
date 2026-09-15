import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className, interactive, muted, children, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean; muted?: boolean }) {
  return <div className={["card", interactive ? "card--interactive" : "", muted ? "card--muted" : "", className ?? ""].filter(Boolean).join(" ")} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, flush }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; flush?: boolean }) {
  return (
    <div className={`card__header${flush ? " card__header--flush" : ""}`}>
      <div style={{ minWidth: 0 }}>
        <h3 className="card__title">{title}</h3>
        {subtitle && <p className="card__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card__body${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="card__footer">{children}</div>;
}
