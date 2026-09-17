"use client";
import { Card, CardBody, Badge } from "@dhanvi/ui";
import { NextActionCard } from "./next-action-card";
import { WorkflowStepper } from "./workflow-stepper";
import { responsibleLabel, type WorkflowSummary, type WorkflowState } from "./workflow-status";

const BADGE: Record<WorkflowState, { tone: "success" | "info" | "warning" | "danger" | "neutral" | "indigo"; label: string }> = {
  complete: { tone: "success", label: "Completed" }, current: { tone: "info", label: "In progress" }, waiting: { tone: "indigo", label: "Waiting" },
  blocked: { tone: "danger", label: "Blocked" }, attention: { tone: "warning", label: "Action required" }, upcoming: { tone: "neutral", label: "Not started" },
};

/**
 * The "where am I / what's next" card for a workflow-heavy page.
 * Answers: current stage, what is done, what is happening, who acts next, what is blocking, what to do.
 */
export function WorkflowStatusCard({ summary, viewer = "member", title = "Progress", stepperLabel, bare, hideNoAction }: { summary: WorkflowSummary; viewer?: "member" | "organizer" | "admin"; title?: string; stepperLabel?: string; /** Render without the outer card (when already inside one). */ bare?: boolean; /** Omit the "No action is required" line (operators have a control panel). */ hideNoAction?: boolean }) {
  const badge = BADGE[summary.status];
  const steps = summary.steps;
  const position = summary.position ?? (steps ? { current: Math.max(1, steps.findIndex((s) => s.state === "current" || s.state === "blocked" || s.state === "waiting") + 1 || steps.filter((s) => s.state === "complete").length), total: steps.length } : undefined);
  const nextStep = steps?.find((s) => s.state === "upcoming");
  const who = responsibleLabel(summary.responsibleRole, viewer);
  const body = (
    <>
        <div className="wf-card__head">
          <div>
            <div className="wf-card__eyebrow">{title}{position && <span className="wf-card__position"> · {position.label ?? "Step"} {position.current} of {position.total}</span>}</div>
            <h2 className="wf-card__stage">{summary.stage}</h2>
            <p className="wf-card__headline">{summary.headline}</p>
          </div>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        {steps && <WorkflowStepper steps={steps} label={stepperLabel ?? `${title} steps`} />}
        {summary.detail && <p className="text-sm text-secondary">{summary.detail}</p>}
        <dl className="wf-card__facts">
          {summary.blockedBy && <div className="wf-fact wf-fact--blocked"><dt>Blocked by</dt><dd>{summary.blockedBy}</dd></div>}
          {summary.waitingFor && <div className="wf-fact wf-fact--waiting"><dt>Waiting for</dt><dd>{summary.waitingFor}</dd></div>}
          {who && <div className="wf-fact"><dt>Who acts next</dt><dd>{who}</dd></div>}
          {(summary.next || nextStep) && <div className="wf-fact"><dt>Next step</dt><dd>{summary.next ?? nextStep?.label}</dd></div>}
        </dl>
        {summary.action ? <NextActionCard action={summary.action} viewer={viewer} compact /> : hideNoAction ? null : <p className="wf-noaction" role="status">No action is required from you right now.</p>}
    </>
  );
  if (bare) return <div className="stack wf-card wf-card--bare">{body}</div>;
  return <Card className="wf-card"><CardBody className="stack">{body}</CardBody></Card>;
}
