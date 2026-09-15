"use client";
import Link from "next/link";
import { Button, Icons, LinkButton } from "@dhanvi/ui";
import { formatMoney } from "@dhanvi/utils";
import { ageSince, responsibleLabel, sortActions, type WorkflowAction } from "./workflow-status";

type Viewer = "member" | "organizer" | "admin";
const TONE: Record<WorkflowAction["status"], string> = { blocked: "danger", attention: "warning", current: "primary", waiting: "info", upcoming: "neutral", complete: "success" };
const ICON: Record<WorkflowAction["status"], React.ReactNode> = {
  blocked: <Icons.Alert size={18} />, attention: <Icons.Alert size={18} />, current: <Icons.ChevronRight size={18} />, waiting: <Icons.Clock size={18} />, upcoming: <Icons.Clock size={18} />, complete: <Icons.CheckCircle size={18} />,
};

function isExternal(href: string) { return /^https?:\/\//.test(href); }

/** One actionable item: what, why, who, and the button that goes to the right place. */
export function NextActionCard({ action, viewer = "member", compact }: { action: WorkflowAction; viewer?: Viewer; compact?: boolean }) {
  const who = responsibleLabel(action.responsibleRole, viewer);
  const age = ageSince(action.since);
  const label = action.actionLabel ?? "Open";
  const cta = action.onAction
    ? <Button size="sm" variant={action.status === "waiting" || action.status === "complete" ? "secondary" : "primary"} onClick={action.onAction}>{label}</Button>
    : action.actionHref ? (isExternal(action.actionHref) ? <a className="btn btn--secondary btn--sm" href={action.actionHref}>{label}</a> : <LinkButton size="sm" variant={action.status === "waiting" || action.status === "complete" ? "secondary" : "primary"} href={action.actionHref}>{label}</LinkButton>) : null;
  return (
    <div className={`wf-action wf-action--${TONE[action.status]}${compact ? " wf-action--compact" : ""}`} data-status={action.status}>
      <span className="wf-action__icon" aria-hidden>{ICON[action.status]}</span>
      <div className="wf-action__body">
        <div className="wf-action__title">{action.title}{action.amount != null && <span className="wf-action__amount amount">{formatMoney(action.amount)}</span>}</div>
        {action.description && <div className="wf-action__desc">{action.description}</div>}
        {action.reason && <div className="wf-action__reason"><strong>Reason:</strong> {action.reason}</div>}
        {(who || age) && <div className="wf-action__meta">{who && <span>{action.status === "waiting" ? "Waiting for" : "Next"}: {who}</span>}{age && <span>Waiting {age}</span>}</div>}
      </div>
      {cta && <div className="wf-action__cta">{cta}</div>}
    </div>
  );
}

/** Ordered list of actions with a friendly all-clear state. */
export function NextActionList({ actions, viewer = "member", emptyTitle = "You're all caught up", emptyDescription = "No action is required from you right now.", limit }: { actions: WorkflowAction[]; viewer?: Viewer; emptyTitle?: string; emptyDescription?: string; limit?: number }) {
  const sorted = sortActions(actions);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (shown.length === 0) return <div className="wf-allclear" role="status"><Icons.CheckCircle size={20} /><div><div className="text-strong">{emptyTitle}</div><div className="text-sm text-secondary">{emptyDescription}</div></div></div>;
  return <div className="wf-actions">{shown.map((a, i) => <NextActionCard key={a.id ?? `${a.title}-${i}`} action={a} viewer={viewer} />)}{limit && sorted.length > limit && <p className="text-sm text-muted">{sorted.length - limit} more…</p>}</div>;
}

/** Inline explanation for something the user is waiting on. */
export function WaitingState({ children, who }: { children: React.ReactNode; who?: string }) {
  return <p className="wf-waiting"><Icons.Clock size={14} /> <span><strong>Waiting{who ? ` for ${who}` : ""}.</strong> {children}</span></p>;
}

/** Explains why an action is unavailable instead of showing a bare disabled button. */
export function UnavailableAction({ label, reason, id }: { label: string; reason: React.ReactNode; id: string }) {
  return (
    <div className="wf-unavailable">
      <button type="button" className="btn btn--secondary" disabled aria-describedby={`${id}-reason`}>{label} · Unavailable</button>
      <p id={`${id}-reason`} className="wf-unavailable__reason"><Icons.Info size={14} /> <span><strong>Reason:</strong> {reason}</span></p>
    </div>
  );
}

/** Mobile-first sticky bar for one high-value primary action. Rendered once per page at most. */
export function StickyActionBar({ title, amount, href, label, onAction }: { title: string; amount?: number | null; href?: string; label: string; onAction?: () => void }) {
  return (
    <div className="wf-sticky" role="region" aria-label="Primary action">
      <div className="wf-sticky__text"><span className="wf-sticky__title">{title}</span>{amount != null && <span className="wf-sticky__amount amount">{formatMoney(amount)}</span>}</div>
      {onAction ? <Button onClick={onAction}>{label}</Button> : href ? <Link className="btn btn--primary" href={href}>{label}</Link> : null}
    </div>
  );
}
