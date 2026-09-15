export function Skeleton({ width, height, className, style }: { width?: number | string; height?: number | string; className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton${className ? ` ${className}` : ""}`} style={{ width, height, ...style }} aria-hidden />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack stack--sm" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton skeleton--text" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="group-grid" aria-busy aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton skeleton--card" />)}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid-4" aria-busy aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton" style={{ height: 108, borderRadius: 14 }} />)}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-wrap" aria-busy aria-label="Loading">
      <div className="stack" style={{ gap: 1 }}>
        {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton skeleton--row" style={{ opacity: 1 - i * 0.12 }} />)}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="stack stack--lg" aria-busy aria-label="Loading page">
      <div className="stack stack--sm"><div className="skeleton skeleton--title" style={{ width: 240 }} /><div className="skeleton skeleton--text" style={{ width: 360 }} /></div>
      <SkeletonStats />
      <div className="skeleton skeleton--card" style={{ height: 240 }} />
    </div>
  );
}
