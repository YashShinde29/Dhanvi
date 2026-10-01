"use client";
import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ProtectedPage } from "@dhanvi/auth";
import { auctionService, contributionService, groupService, type GroupScope } from "@dhanvi/api-client";
import type { AuctionScheduleChange } from "@dhanvi/types";
import { useAsyncData, auctionReasonLabel, formatDateTime } from "@dhanvi/utils";
import { PageHeader, Card, DataTable, Pagination, type Column, FormField, Select, ErrorState, PageSkeleton, ResponsiveFilters, Badge, useIsPhone } from "@dhanvi/ui";

const PAGE_SIZE = 20;

/**
 * Full auction schedule history for one group — every cycle, newest first, server-paged (20 per page) with a cycle filter.
 * Reached from the group's Cycles tab; the group and auction pages themselves only show the latest change.
 */
export function AuctionScheduleHistoryPage({ scope }: { scope: "organizer" | "admin" }) {
  return <ProtectedPage roles={scope === "admin" ? ["ADMIN", "SUPER_ADMIN"] : ["ORGANIZER"]}><Suspense fallback={<PageSkeleton />}><History scope={scope} /></Suspense></ProtectedPage>;
}

function History({ scope }: { scope: "organizer" | "admin" }) {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [cycleId, setCycleId] = useState(params.get("cycleId") ?? "");
  const [page, setPage] = useState(1);
  const group = useAsyncData(() => groupService.details(id, scope as GroupScope), [id, scope]);
  const cycles = useAsyncData(() => contributionService.cycles(id, scope), [id, scope]);
  const history = useAsyncData(() => auctionService.groupScheduleHistory(scope, id, { cycleId: cycleId || undefined, page, pageSize: PAGE_SIZE }), [scope, id, cycleId, page]);
  const phone = useIsPhone();
  const g = group.data; const zone = g?.groupTimeZone ?? "Asia/Kolkata";
  const groupHref = scope === "admin" ? `/groups/${id}` : `/organizer/groups/${id}`;
  const columns: Column<AuctionScheduleChange>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (c) => <span className="text-strong">Cycle {c.cycleNumber} <span className="text-muted" style={{ fontWeight: 400 }}>· change #{c.changeSequence}</span></span> },
    { key: "previous", header: "Previous schedule", render: (c) => formatDateTime(c.previousStartsAt, zone) },
    { key: "new", header: "New schedule", mobile: "emphasis", render: (c) => <span className="text-strong">{formatDateTime(c.newStartsAt, zone)}</span> },
    { key: "reason", header: "Reason", render: (c) => <span className="cell-tight"><Badge tone="neutral" plain>{auctionReasonLabel(c.reasonCode)}</Badge>{c.reasonText && <span className="cell__sub">{c.reasonText}</span>}{c.memberMessage && <span className="cell__sub">Members: “{c.memberMessage}”</span>}</span> },
    { key: "by", header: "Changed by", render: (c) => <>{c.changedByRole === "ADMIN" ? "Dhanvi admin" : "Organizer"}{c.changedByName && <span className="cell__sub">{c.changedByName}</span>}</> },
    { key: "at", header: "Changed at", render: (c) => formatDateTime(c.changedAt, zone) },
  ];
  if (group.error) return <ErrorState message={group.error} onRetry={group.reload} />;
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow={scope === "admin" ? "Control center" : "Organizer"} title="Auction schedule history" description={g ? `${g.name} · every reschedule across all ${g.durationMonths} cycles, newest first.` : undefined}
        breadcrumbs={[{ label: scope === "admin" ? "Groups" : "My managed groups", href: scope === "admin" ? "/groups" : "/organizer/groups" }, { label: g?.name ?? "Group", href: groupHref }, { label: "Auction schedule history" }]} />
      <ResponsiveFilters label="History filters" title="Filter history" activeCount={cycleId ? 1 : 0} onClear={() => { setCycleId(""); setPage(1); }}>
        <FormField label="Cycle" htmlFor="history-cycle"><Select id="history-cycle" value={cycleId} onChange={(e) => { setCycleId(e.target.value); setPage(1); }}><option value="">All cycles</option>{(cycles.data ?? []).filter((c) => c.selectionMethod === "AUCTION").map((c) => <option key={c.id} value={c.id}>Cycle {c.cycleNumber}{(c.auctionRescheduleCount ?? 0) > 0 ? ` · rescheduled ${c.auctionRescheduleCount}×` : ""}</option>)}</Select></FormField>
      </ResponsiveFilters>
      {history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : (
        <Card>
          {/* Phones: one card per change. Tablet and up: a dense table that scrolls inside its own container, never the page. */}
          <DataTable columns={columns} rows={history.loading && !history.data ? undefined : history.data?.items} loading={history.loading} rowKey={(c) => c.id} caption="Auction schedule history" compact={scope === "admin"} responsive={phone} minWidth={980}
            empty={{ title: cycleId ? "No schedule changes for this cycle" : "No auction has been rescheduled in this group", description: "Every reschedule is recorded here with its reason and who made it." }} />
          <div className="card__body"><Pagination page={page} pageSize={PAGE_SIZE} totalCount={history.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="schedule changes" /></div>
        </Card>
      )}
    </div>
  );
}
