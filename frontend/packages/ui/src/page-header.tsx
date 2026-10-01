import Link from "next/link";
import type { ReactNode } from "react";
import { Icons } from "./icons";
import { OverflowMenu, type MenuAction } from "./menu";

export interface Crumb { label: string; href?: string }

/**
 * Full trail on tablet/desktop. On phones the trail collapses to a single "‹ Parent" link (the page title sits directly
 * below, so repeating the current crumb only costs vertical space); see .breadcrumbs__back in globals.css.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const parent = [...items].reverse().find((item, index) => index > 0 && item.href);
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {parent && <Link href={parent.href!} className="breadcrumbs__back"><Icons.ChevronLeft size={16} aria-hidden /><span>{parent.label}</span></Link>}
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="breadcrumbs__item">
          {index > 0 && <span className="breadcrumbs__sep" aria-hidden>/</span>}
          {item.href && index < items.length - 1 ? <Link href={item.href} title={item.label}>{item.label}</Link> : <span className="breadcrumbs__current" aria-current="page" title={item.label}>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/**
 * Page title block. `actions` holds the one primary action (full width on phones); `menu` holds secondary actions that
 * render as a ⋯ menu at every size, so phones never show three or four buttons in a row.
 */
export function PageHeader({ eyebrow, title, description, actions, menu, breadcrumbs, badges }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; menu?: MenuAction[]; breadcrumbs?: Crumb[]; badges?: ReactNode }) {
  const hasMenu = !!menu && menu.length > 0;
  return (
    <div className="stack stack--sm">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <header className="page-header">
        <div className="page-header__text">
          {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
          <div className="page-header__title"><h1 className="h-page">{title}</h1>{badges}</div>
          {description && <p className="page-header__desc">{description}</p>}
        </div>
        {(actions || hasMenu) && <div className="page-header__actions">{actions}{hasMenu && <OverflowMenu items={menu} label="More page actions" />}</div>}
      </header>
    </div>
  );
}

export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section__header">
      <div style={{ minWidth: 0 }}>
        <h2 className="h-section">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
