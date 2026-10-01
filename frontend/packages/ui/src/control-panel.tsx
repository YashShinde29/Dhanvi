import type { ReactNode } from "react";
import { Badge } from "./badge";
import type { Tone } from "@dhanvi/utils";

/**
 * "Current situation" panel: stage, headline, facts (waiting on / blocked by / next), and exactly one primary action.
 * Pages render one of these at most; every other section links to detail instead of repeating the action.
 */
export function ControlPanel({ eyebrow = "Current situation", stage, badge, headline, children, facts, primary, secondary, menu, status }: {
  eyebrow?: string; /** Drives the accent colour (blocked / attention / waiting / complete). */ status?: string; stage: ReactNode; badge?: { tone: Tone; label: string }; headline?: ReactNode; children?: ReactNode;
  facts?: { label: string; value: ReactNode; tone?: "blocked" | "waiting" }[]; primary?: ReactNode; secondary?: ReactNode; menu?: ReactNode;
}) {
  return (
    <section className="ops" aria-label={eyebrow} data-status={status}>
      <div className="ops__head">
        <div className="ops__text">
          <div className="ops__eyebrow">{eyebrow}</div>
          <h2 className="ops__stage">{stage}</h2>
          {headline && <p className="ops__headline">{headline}</p>}
        </div>
        <div className="row" style={{ gap: 8 }}>{badge && <Badge tone={badge.tone}>{badge.label}</Badge>}{menu}</div>
      </div>
      {children}
      {facts && facts.length > 0 && (
        <dl className="ops__facts">
          {facts.map((f) => <div key={f.label} className={`ops__fact${f.tone ? ` ops__fact--${f.tone}` : ""}`}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}
      {(primary || secondary) && <div className="ops__actions">{primary}{secondary && <div className="ops__secondary">{secondary}</div>}</div>}
    </section>
  );
}

/** Dense key facts strip for page heads (Group value · Members · Cycle …). */
export function FactStrip({ items, label }: { items: { label: string; value: ReactNode }[]; label?: string }) {
  return (
    <dl className="facts" aria-label={label}>
      {items.map((i) => <div key={i.label} className="facts__item"><dt>{i.label}</dt><dd>{i.value}</dd></div>)}
    </dl>
  );
}
