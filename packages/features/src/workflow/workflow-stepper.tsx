import { Icons } from "@dhanvi/ui";
import type { WorkflowStep, WorkflowState } from "./workflow-status";

const ICON: Record<WorkflowState, React.ReactNode> = {
  complete: <Icons.Check size={14} />, current: <span className="wf-step__dot" aria-hidden />, waiting: <Icons.Clock size={14} />,
  blocked: <Icons.Alert size={14} />, attention: <Icons.Alert size={14} />, upcoming: <span className="wf-step__dot wf-step__dot--muted" aria-hidden />,
};
const SR: Record<WorkflowState, string> = { complete: "Completed", current: "Current step", waiting: "Waiting", blocked: "Blocked", attention: "Needs attention", upcoming: "Not started" };

/**
 * Compact lifecycle stepper. State is conveyed by icon + visually-hidden text, not colour alone.
 * Horizontal on wide screens, vertical on phones (see .wf-stepper CSS).
 */
export function WorkflowStepper({ steps, label = "Progress" }: { steps: WorkflowStep[]; label?: string }) {
  return (
    <ol className="wf-stepper" aria-label={label}>
      {steps.map((step, index) => (
        <li key={step.id} className={`wf-step wf-step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="wf-step__marker">{ICON[step.state]}<span className="sr-only">{SR[step.state]}: </span></span>
          <span className="wf-step__body">
            <span className="wf-step__label">{index + 1}. {step.label}</span>
            {step.hint && <span className="wf-step__hint">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
