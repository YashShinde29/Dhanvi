import Link from "next/link";
import type { ReactNode } from "react";

export interface Crumb { label: string; href?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="row" style={{ gap: 8 }}>
          {index > 0 && <span className="breadcrumbs__sep" aria-hidden>/</span>}
          {item.href && index < items.length - 1 ? <Link href={item.href}>{item.label}</Link> : <span className="breadcrumbs__current" aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ eyebrow, title, description, actions, breadcrumbs, badges }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: Crumb[]; badges?: ReactNode }) {
  return (
    <div className="stack stack--sm">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <header className="page-header">
        <div className="page-header__text">
          {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
          <div className="page-header__title"><h1 className="h-page">{title}</h1>{badges}</div>
          {description && <p className="page-header__desc">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </header>
    </div>
  );
}

export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section__header">
      <div>
        <h2 className="h-section">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
