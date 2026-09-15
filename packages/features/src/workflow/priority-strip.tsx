"use client";
/** Admin triage strip: ACTION REQUIRED / WAITING FOR PROVIDER / COMPLETED / FAILED / RECONCILIATION counts that double as filters. */
export interface PriorityBucket { id: string; label: string; count: number; tone: "danger" | "warning" | "info" | "success" | "neutral"; hint?: string }
export function PriorityStrip({ buckets, value, onChange }: { buckets: PriorityBucket[]; value?: string; onChange?: (id: string) => void }) {
  return (
    <div className="wf-priority" role={onChange ? "group" : undefined} aria-label="Priority">
      {buckets.map((b) => {
        const content = <><span className="wf-priority__label">{b.label}</span><span className="wf-priority__count">{b.count}</span>{b.hint && <span className="text-xs text-muted">{b.hint}</span>}</>;
        return onChange
          ? <button key={b.id} type="button" className={`wf-priority__item wf-priority__item--${b.tone}`} aria-pressed={value === b.id} onClick={() => onChange(value === b.id ? "" : b.id)}>{content}</button>
          : <div key={b.id} className={`wf-priority__item wf-priority__item--${b.tone}`}>{content}</div>;
      })}
    </div>
  );
}
