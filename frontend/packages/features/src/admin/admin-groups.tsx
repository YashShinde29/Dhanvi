"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProtectedPage } from "@dhanvi/auth";
import { adminService } from "@dhanvi/api-client";
import type { AdminGroupRow } from "@dhanvi/types";
import { useAsyncData, useDebounced, ALL_GROUP_STATUSES, formatDateTime, formatMoney, presentStatus, statusLabel } from "@dhanvi/utils";
import { PageHeader, LinkButton, Button, DataTable, Pagination, type Column, FormField, Select, SearchInput, ErrorState, Icons, CreatorTypeBadge, StatusBadge, PageSkeleton, Badge, ResponsiveFilters } from "@dhanvi/ui";
import { groupHealth, HEALTH_OPTIONS, type HealthLevel } from "../workflow";

const CYCLE_STATES = ["COLLECTING_CONTRIBUTIONS", "READY_FOR_SELECTION", "SELECTION_COMPLETED", "PAYOUT_PENDING", "COMPLETED", "SUSPENDED"];

export function AdminGroupsPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><Suspense fallback={<PageSkeleton />}><AdminGroups /></Suspense></ProtectedPage>;
}

export function HealthBadge({ level, label }: { level: HealthLevel; label: string }) { return <span className={`health health--${level}`}>{label}</span>; }

function MiniProgress({ value, max, label }: { value: number; max: number; label: string }) {
  return <span className="mini-progress"><span className="mini-progress__track"><span className="mini-progress__bar" style={{ width: `${max ? Math.min(100, Math.round((value / max) * 100)) : 0}%` }} /></span><span className="mini-progress__label">{label}</span></span>;
}

/**
 * Admin group management table: platform-wide, dense, filterable. One entry point per row ("View") — every
 * operational control lives on the group's page. Filters are mirrored in the URL so dashboard cards deep-link here.
 */
function AdminGroups() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [creator, setCreator] = useState(params.get("creatorType") ?? "");
  const [type, setType] = useState(params.get("groupType") ?? "");
  const [cycleStatus, setCycleStatus] = useState(params.get("cycleStatus") ?? "");
  const [health, setHealth] = useState<HealthLevel | "">((params.get("health") as HealthLevel | null) ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);
  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) q.set("status", status); if (creator) q.set("creatorType", creator); if (type) q.set("groupType", type); if (cycleStatus) q.set("cycleStatus", cycleStatus);
    if (debouncedSearch.trim()) q.set("search", debouncedSearch.trim());
    return q.toString();
  }, [page, status, creator, type, cycleStatus, debouncedSearch]);
  const { data, error, loading, reload } = useAsyncData(() => adminService.groups(query), [query]);
  const set = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };
  const rows = (data?.items ?? []).map((g) => ({ g, health: groupHealth(g) })).filter((r) => !health || r.health.level === health);
  const activeFilters = [status, creator, type, cycleStatus, health, search].filter(Boolean).length;
  function clear() { setStatus(""); setCreator(""); setType(""); setCycleStatus(""); setHealth(""); setSearch(""); setPage(1); router.replace("/groups"); }

  const columns: Column<{ g: AdminGroupRow; health: ReturnType<typeof groupHealth> }>[] = [
    { key: "group", header: "Group", primary: true, render: ({ g }) => <span className="cell-tight"><Link className="link text-strong" href={`/groups/${g.id}`}>{g.name}</Link><span className="cell__sub">{g.groupType === "AUCTION" ? "Auction" : "Random"} · {g.collectionMode === "RAZORPAY" ? "Razorpay" : "Manual"} · {g.durationMonths} cycles</span></span> },
    { key: "creator", header: "Creator", render: ({ g }) => <span className="cell-tight"><CreatorTypeBadge creatorType={g.creatorType} />{g.organizerName && <span className="cell__sub">{g.organizerName}{g.organizerStatus && g.organizerStatus !== "APPROVED" ? ` · ${statusLabel("organizer", g.organizerStatus)}` : ""}</span>}</span> },
    { key: "value", header: "Value", align: "right", render: ({ g }) => <span className="cell-tight"><span className="amount">{formatMoney(g.groupValue)}</span><span className="cell__sub">{formatMoney(g.monthlyContribution)}/mo</span></span> },
    { key: "members", header: "Members", render: ({ g }) => <MiniProgress value={g.currentMemberCount} max={g.memberLimit} label={`${g.currentMemberCount} / ${g.memberLimit}${g.pendingApplications ? ` · ${g.pendingApplications} applied` : ""}`} /> },
    { key: "lifecycle", header: "Lifecycle", render: ({ g }) => <StatusBadge kind="group" value={g.status} /> },
    { key: "cycle", header: "Cycle", render: ({ g }) => g.currentCycle ? <span className="cell-tight"><span className="text-strong num">{g.currentCycle.cycleNumber} / {g.durationMonths}</span><span className="cell__sub">{statusLabel("cycle", g.currentCycle.status)}</span></span> : <span className="text-muted">—</span> },
    { key: "collection", header: "Collection", render: ({ g }) => g.currentCycle ? <MiniProgress value={g.currentCycle.settledMemberCount} max={g.currentCycle.expectedMemberCount} label={`${g.currentCycle.settledMemberCount} / ${g.currentCycle.expectedMemberCount} settled`} /> : <span className="text-muted">—</span> },
    { key: "selection", header: "Selection", render: ({ g }) => { const c = g.currentCycle; if (!c) return <span className="text-muted">—</span>; if (c.auctionStatus) return <span className="cell-tight"><span>{statusLabel("auction", c.auctionStatus)}</span>{c.winnerName && <span className="cell__sub">#{c.winnerSlotNumber} {c.winnerName}</span>}</span>; if (c.selectionResultId) return <span className="cell-tight"><span>Done</span><span className="cell__sub">#{c.winnerSlotNumber} {c.winnerName}</span></span>; return <span className="text-muted">{c.status === "READY_FOR_SELECTION" ? "Ready" : "Waiting"}</span>; } },
    { key: "payout", header: "Payouts", render: ({ g }) => { const p = g.payouts; const parts = [p.reconciliationRequired && `${p.reconciliationRequired} mismatch`, p.failed && `${p.failed} failed`, p.approvalRequired && `${p.approvalRequired} to approve`, p.approved && `${p.approved} to execute`, p.pendingBeneficiary && `${p.pendingBeneficiary} no account`, p.processing && `${p.processing} processing`, p.succeeded && `${p.succeeded} paid`].filter(Boolean) as string[]; return parts.length ? <span className="cell-tight">{parts.slice(0, 2).map((t) => <span key={t} style={{ display: "block" }}>{t}</span>)}</span> : <span className="text-muted">—</span>; } },
    { key: "health", header: "Health", render: ({ health: h }) => <span className="cell-tight"><HealthBadge level={h.level} label={h.label} /><span className="cell__sub" title={h.reason}>{h.reason}</span></span> },
    { key: "activity", header: "Last activity", render: ({ g }) => <span className="text-muted text-xs">{formatDateTime(g.lastActivityAt)}</span> },
    { key: "actions", header: "", actions: true, render: ({ g }) => <LinkButton href={`/groups/${g.id}`} variant="secondary" size="sm">View</LinkButton> },
  ];

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Control center" title="Groups" description="Every group on Dhanvi with its lifecycle, current cycle, collection, selection, payout and health at a glance."
        actions={<LinkButton href="/groups/create" icon={<Icons.Plus size={16} />}>Create platform group</LinkButton>} />
      <ResponsiveFilters label="Group filters" title="Filter groups" activeCount={activeFilters - (search ? 1 : 0)} onClear={clear}
        search={<SearchInput value={search} onChange={set(setSearch)} placeholder="Search by group name" />}>
        <FormField label="Lifecycle" htmlFor="f-status"><Select id="f-status" value={status} onChange={(e) => set(setStatus)(e.target.value)}><option value="">Any lifecycle</option>{ALL_GROUP_STATUSES.map((s) => <option key={s} value={s}>{presentStatus("group", s).label}</option>)}</Select></FormField>
        <FormField label="Creator" htmlFor="f-creator"><Select id="f-creator" value={creator} onChange={(e) => set(setCreator)(e.target.value)}><option value="">Any creator</option><option value="PLATFORM">Dhanvi platform</option><option value="ORGANIZER">Organizer</option></Select></FormField>
        <FormField label="Type" htmlFor="f-type"><Select id="f-type" value={type} onChange={(e) => set(setType)(e.target.value)}><option value="">Any type</option><option value="RANDOM">Random</option><option value="AUCTION">Auction</option></Select></FormField>
        <FormField label="Cycle state" htmlFor="f-cycle"><Select id="f-cycle" value={cycleStatus} onChange={(e) => set(setCycleStatus)(e.target.value)}><option value="">Any cycle state</option>{CYCLE_STATES.map((s) => <option key={s} value={s}>{presentStatus("cycle", s).label}</option>)}</Select></FormField>
        <FormField label="Health" htmlFor="f-health"><Select id="f-health" value={health} onChange={(e) => { setHealth(e.target.value as HealthLevel | ""); }}>{HEALTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
      </ResponsiveFilters>
      {error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <DataTable columns={columns} rows={loading && !data ? undefined : rows} loading={loading} rowKey={(r) => r.g.id} caption="Groups" compact responsive={false} minWidth={1180}
            empty={{ title: activeFilters ? "No groups match these filters" : "No groups yet", description: activeFilters ? (health ? "Health is evaluated on the loaded page; widen the other filters or clear them." : "Try clearing filters.") : "Create the first platform group to get started.", action: activeFilters ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined }} />
          {data && <div className="row row--between"><Pagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} itemLabel="groups" />{health && data.totalCount > data.pageSize && <Badge tone="neutral" plain>Health filter applies to this page</Badge>}</div>}
        </>
      )}
    </div>
  );
}
