import type { ReactNode } from "react";

/** Who must act next. FINANCE is not a backend role; it labels admin financial operations. */
export type ResponsibleRole = "USER" | "ORGANIZER" | "ADMIN" | "FINANCE" | "SYSTEM";
export type WorkflowState = "complete" | "current" | "waiting" | "blocked" | "attention" | "upcoming";

export interface WorkflowAction {
  id?: string;
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  /** Use instead of actionHref when the action runs in place (opens a dialog, submits, etc.). */
  onAction?: () => void;
  status: WorkflowState;
  responsibleRole?: ResponsibleRole;
  /** Shown for blocked/unavailable actions: the exact reason. */
  reason?: ReactNode;
  /** Sort hint: lower comes first. */
  priority?: number;
  /** When the item was created/last changed, for "waiting since" copy. */
  since?: string | null;
  /** Amount to emphasise (e.g. contribution due). */
  amount?: number | null;
}

export interface WorkflowStep { id: string; label: string; state: WorkflowState; hint?: ReactNode }

/** A complete "where am I" summary for a workflow-heavy page. */
export interface WorkflowSummary {
  /** e.g. "Cycle 2 contributions" */
  stage: string;
  status: WorkflowState;
  /** Human-readable status line, e.g. "18 of 20 contributions settled". */
  headline: string;
  /** One-line explanation. */
  detail?: ReactNode;
  /** Who acts next. */
  responsibleRole?: ResponsibleRole;
  /** Explicit waiting / blocking reason. */
  waitingFor?: ReactNode;
  blockedBy?: ReactNode;
  /** What happens after the current step. */
  next?: ReactNode;
  /** The viewer's own action, if any. */
  action?: WorkflowAction;
  steps?: WorkflowStep[];
  /** "3 of 6" style position, derived from steps when omitted. */
  position?: { current: number; total: number; label?: string };
}

export const ROLE_LABEL: Record<ResponsibleRole, string> = { USER: "You", ORGANIZER: "Organizer", ADMIN: "Dhanvi admin", FINANCE: "Finance operations", SYSTEM: "Provider / automatic" };

/** Label for the responsible party from the viewer's perspective. */
export function responsibleLabel(role: ResponsibleRole | undefined, viewer: "member" | "organizer" | "admin"): string {
  if (!role) return "";
  if (role === "USER") return viewer === "member" ? "You" : "Member";
  if (role === "ORGANIZER") return viewer === "organizer" ? "You" : "Organizer";
  if (role === "ADMIN" || role === "FINANCE") return viewer === "admin" ? "You" : "Dhanvi admin";
  return "Provider / automatic";
}

export function sortActions(actions: WorkflowAction[]): WorkflowAction[] {
  const rank: Record<WorkflowState, number> = { blocked: 0, attention: 1, current: 2, waiting: 3, upcoming: 4, complete: 5 };
  return [...actions].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || rank[a.status] - rank[b.status]);
}

/** "2 hours", "3 days" — for waiting-since copy. */
export function ageSince(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
