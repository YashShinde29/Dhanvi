import type { ReactNode } from "react";
import { Icons } from "./icons";

export interface TimelineStep { id: string; title: string; description?: ReactNode; state: "done" | "current" | "upcoming" }

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="timeline" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {steps.map((step, index) => (
        <li key={step.id} className={`timeline__item timeline__item--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="timeline__marker">{step.state === "done" ? <Icons.Check size={14} /> : index + 1}</span>
          <div>
            <div className="timeline__title">{step.title}</div>
            {step.description && <div className="timeline__desc">{step.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="steps" style={{ margin: 0, padding: 0, listStyle: "none" }} aria-label="Progress">
      {steps.map((step, index) => (
        <li key={step} className={`steps__item${index < current ? " steps__item--done" : index === current ? " steps__item--current" : ""}`} aria-current={index === current ? "step" : undefined}>
          <span className={`timeline__marker`} style={index < current ? { background: "var(--color-primary-700)", borderColor: "var(--color-primary-700)", color: "#fff" } : index === current ? { borderColor: "var(--color-primary-700)", color: "var(--color-primary-800)" } : undefined}>
            {index < current ? <Icons.Check size={14} /> : index + 1}
          </span>
          <span className="steps__label">{step}</span>
        </li>
      ))}
    </ol>
  );
}
