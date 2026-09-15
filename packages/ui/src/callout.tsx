import type { ReactNode } from "react";
import { Icons } from "./icons";

export type CalloutVariant = "info" | "warning" | "success" | "danger" | "neutral";

const icons: Record<CalloutVariant, ReactNode> = {
  info: <Icons.Info size={20} />, warning: <Icons.Alert size={20} />, success: <Icons.CheckCircle size={20} />, danger: <Icons.Alert size={20} />, neutral: <Icons.Info size={20} />,
};

export function Callout({ variant = "info", title, children, actions, role }: { variant?: CalloutVariant; title?: ReactNode; children?: ReactNode; actions?: ReactNode; role?: "alert" | "status" }) {
  return (
    <div className={`callout callout--${variant}`} role={role ?? (variant === "danger" ? "alert" : undefined)}>
      <span className="callout__icon">{icons[variant]}</span>
      <div className="callout__body">
        {title && <div className="callout__title">{title}</div>}
        {children && <div>{children}</div>}
        {actions && <div className="row" style={{ marginTop: 10 }}>{actions}</div>}
      </div>
    </div>
  );
}

export const InfoCard = (p: Omit<Parameters<typeof Callout>[0], "variant">) => <Callout variant="info" {...p} />;
export const WarningCard = (p: Omit<Parameters<typeof Callout>[0], "variant">) => <Callout variant="warning" {...p} />;
export const SuccessBanner = (p: Omit<Parameters<typeof Callout>[0], "variant">) => <Callout variant="success" role="status" {...p} />;

export function ErrorState({ message, onRetry, title = "Something went wrong" }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <Callout variant="danger" title={title} actions={onRetry && <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}><Icons.Refresh size={14} /> Try again</button>}>
      {message}
    </Callout>
  );
}
