import type { ReactNode } from "react";

export interface KeyValue { key: string; value: ReactNode }

export function DescriptionList({ items, stack }: { items: KeyValue[]; stack?: boolean }) {
  return (
    <dl className={`dl${stack ? " dl--stack" : ""}`}>
      {items.map((item) => (
        <div key={item.key} style={{ display: "contents" }}>
          <dt>{item.key}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Vertical key/value rows for summaries and financial breakdowns. */
export function KeyValueRows({ items, total }: { items: KeyValue[]; total?: KeyValue }) {
  return (
    <div>
      {items.map((item) => <div key={item.key} className="kv"><span className="kv__key">{item.key}</span><span className="kv__value">{item.value}</span></div>)}
      {total && <div className="kv kv--total"><span className="kv__key">{total.key}</span><span className="kv__value">{total.value}</span></div>}
    </div>
  );
}

export function RuleList({ items }: { items: KeyValue[] }) {
  return (
    <div className="rule-list">
      {items.map((item) => <div key={item.key} className="rule"><span className="rule__key">{item.key}</span><span className="rule__value">{item.value}</span></div>)}
    </div>
  );
}

export function Fact({ label, value, large }: { label: string; value: ReactNode; large?: boolean }) {
  return <div className="fact"><span className="fact__label">{label}</span><span className={`fact__value${large ? " fact__value--lg" : ""}`}>{value}</span></div>;
}
