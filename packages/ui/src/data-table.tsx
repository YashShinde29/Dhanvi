"use client";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Icons } from "./icons";
import { EmptyState } from "./empty-state";
import { SkeletonTable } from "./skeleton";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Marks the primary cell (shown as the card title on mobile; pinned on scroll tables). */
  primary?: boolean;
  /** Row actions cell: right-aligned, no mobile label, always last on mobile. */
  actions?: boolean;
  className?: string;
  /** Hide the data-label on mobile (e.g. for badges that explain themselves). */
  noLabel?: boolean;
  /**
   * Phone card treatment (responsive tables only):
   * - "hidden": low-priority column that the card omits;
   * - "emphasis": the key value (usually money), rendered large;
   * - "status": shown directly under the title without a label.
   */
  mobile?: "hidden" | "emphasis" | "status";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  caption?: string;
  compact?: boolean;
  /**
   * true (default): rows become cards on phones — for member-facing lists.
   * false: the table keeps its columns and scrolls sideways with the primary column pinned — for dense operational data.
   */
  responsive?: boolean;
  /** Scroll tables only: minimum table width so columns stay readable (default 720px; use ~90px per column). */
  minWidth?: number;
}

export function DataTable<T>({ columns, rows, rowKey, loading, empty, caption, compact, responsive = true, minWidth }: DataTableProps<T>) {
  if (loading && !rows) return <SkeletonTable />;
  if (rows && rows.length === 0) return <EmptyState compact title={empty?.title ?? "Nothing to show"} description={empty?.description} action={empty?.action} />;
  const scroll = !responsive;
  const hasPrimary = columns.some((c) => c.primary);
  return (
    <div className={`table-wrap${scroll ? " table-wrap--scroll" : ""}`}>
      <table className={["table", responsive ? "table--responsive" : "table--scroll", scroll && hasPrimary ? "table--sticky-first" : "", compact ? "table--compact" : ""].filter(Boolean).join(" ")} style={scroll && minWidth ? ({ "--table-min-width": `${minWidth}px` } as React.CSSProperties) : undefined}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={cellClass(c)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => <td key={c.key} className={cellClass(c)} data-label={typeof c.header === "string" ? c.header : undefined}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {scroll && <div className="table-wrap__hint" aria-hidden><Icons.ChevronLeft size={12} /><span>Swipe sideways for more columns</span><Icons.ChevronRight size={12} /></div>}
    </div>
  );
}

function cellClass<T>(c: Column<T>) {
  return [
    c.align === "right" ? "cell--right" : c.align === "center" ? "cell--center" : "",
    c.primary ? "cell--primary" : "", c.actions ? "cell--actions" : "", c.noLabel ? "cell--nolabel" : "",
    c.mobile === "hidden" ? "cell--mobile-hidden" : c.mobile === "emphasis" ? "cell--emphasis" : c.mobile === "status" ? "cell--status" : "",
    c.className ?? "",
  ].filter(Boolean).join(" ");
}

export function Pagination({ page, pageSize, totalCount, onPageChange, itemLabel = "items" }: { page: number; pageSize: number; totalCount: number; onPageChange: (page: number) => void; itemLabel?: string }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalCount <= pageSize) return totalCount > 0 ? <p className="pagination__info">{totalCount} {itemLabel}</p> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__info">Showing {from}–{to} of {totalCount} {itemLabel}</span>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <Button variant="secondary" size="sm" icon={<Icons.ChevronLeft size={16} />} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page"><span className="hide-mobile">Previous</span></Button>
        <span className="text-sm text-muted num" style={{ whiteSpace: "nowrap" }}>Page {page} of {totalPages}</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page"><span className="hide-mobile">Next</span> <Icons.ChevronRight size={16} /></Button>
      </div>
    </nav>
  );
}
