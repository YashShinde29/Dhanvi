"use client";
import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { Drawer } from "./dialog";
import { Icons } from "./icons";
import { useIsPhone } from "./use-media-query";

/**
 * Filter controls that adapt to the viewport without duplicating state:
 * - tablet/desktop: an inline bar (search first, then the fields, then Clear);
 * - phones: the search stays full width next to a "Filters (n)" button that opens a sheet holding the same fields.
 * The fields render exactly once (inline or in the sheet, decided by the viewport), so ids stay unique and a value chosen
 * in the sheet is the value shown inline when the viewport grows (state lives in the page, never here).
 */
export function ResponsiveFilters({ search, children, activeCount = 0, onClear, summary, title = "Filters", label = "Filters" }: {
  /** Search input rendered outside the sheet (always visible). */
  search?: ReactNode;
  /** The filter fields (FormField + Select/Input). */
  children: ReactNode;
  /** Number of non-default filters; shown on the trigger and enables Clear. */
  activeCount?: number;
  onClear?: () => void;
  /** Optional chips summarising active filters under the search on phones. */
  summary?: ReactNode;
  title?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  if (!phone) {
    return (
      <div className="rfilters" role="search" aria-label={label}>
        <div className="rfilters__bar">
          {search}
          {children}
          {activeCount > 0 && onClear && <Button variant="ghost" size="sm" onClick={onClear}>Clear ({activeCount})</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className="rfilters" role="search" aria-label={label}>
      <div className="rfilters__mobile">
        {search}
        <Button variant={activeCount > 0 ? "primary" : "secondary"} className="rfilters__trigger" icon={<Icons.Filter size={16} />} onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog">
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
      {summary && <div className="rfilters__summary">{summary}</div>}
      <Drawer open={open} onClose={() => setOpen(false)} title={title}
        footer={<>{onClear && <Button variant="ghost" onClick={onClear} disabled={activeCount === 0}>Clear all</Button>}<Button onClick={() => setOpen(false)}>Show results</Button></>}>
        <div className="filters">{children}</div>
      </Drawer>
    </div>
  );
}
