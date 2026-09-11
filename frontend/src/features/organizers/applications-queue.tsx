"use client";
import { useState } from "react";
import { organizerService } from "@/services/organizer.service";
import type { OrganizerApplicationSummary } from "@/types/organizer";
import { useAsyncData } from "@/hooks/use-async-data";
import { useDebounced } from "@/hooks/use-debounced";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/callout";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { DescriptionList } from "@/components/ui/description";
import { Drawer } from "@/components/ui/dialog";
import { ChipGroup } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { ORGANIZER_APPLICATION_STATUSES, presentStatus } from "@/lib/status";

export function OrganizerApplicationsQueue() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);
  const [selected, setSelected] = useState<OrganizerApplicationSummary | null>(null);
  const [busyId, setBusyId] = useState("");
  const { data, error, loading, reload } = useAsyncData(() => organizerService.applications(page, 20, status, debouncedSearch.trim()), [page, status, debouncedSearch]);

  async function approve(item: OrganizerApplicationSummary) {
    const result = await confirm({ title: `Approve ${item.applicant} as an organizer?`, description: "They will be able to create and manage savings groups immediately. You can suspend organizer access later if needed.", confirmLabel: "Approve organizer" });
    if (!result.confirmed) return;
    setBusyId(item.id);
    try { await organizerService.approve(item.id); toast.success("Organizer approved", `${item.applicant} can now create groups.`); setSelected(null); await reload(); }
    catch (failure) { toast.error("Approval failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }
  async function reject(item: OrganizerApplicationSummary) {
    const result = await confirm({ title: `Reject ${item.applicant}'s application?`, description: "The applicant will see your reason and may apply again later.", reason: { label: "Reason for rejection" }, confirmLabel: "Reject application", variant: "danger" });
    if (!result.confirmed) return;
    setBusyId(item.id);
    try { await organizerService.reject(item.id, result.reason ?? ""); toast.success("Application rejected"); setSelected(null); await reload(); }
    catch (failure) { toast.error("Rejection failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }

  const reviewable = (item: OrganizerApplicationSummary) => item.status === "PENDING" || item.status === "UNDER_REVIEW";
  const columns: Column<OrganizerApplicationSummary>[] = [
    { key: "applicant", header: "Applicant", primary: true, render: (a) => <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar name={a.applicant} size="sm" /><span style={{ minWidth: 0 }}><span className="text-strong" style={{ display: "block" }}>{a.applicant}</span><span className="cell__sub">{a.email}</span></span></span> },
    { key: "submitted", header: "Submitted", render: (a) => formatDate(a.submittedAt) },
    { key: "status", header: "Status", render: (a) => <StatusBadge kind="organizer" value={a.status} /> },
    { key: "actions", header: "Actions", actions: true, render: (a) => (
      <span className="row" style={{ gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => setSelected(a)}>View</Button>
        {reviewable(a) && <><Button size="sm" loading={busyId === a.id} disabled={!!busyId} onClick={() => approve(a)}>Approve</Button><Button size="sm" variant="danger-outline" disabled={!!busyId} onClick={() => reject(a)}>Reject</Button></>}
      </span>
    ) },
  ];

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Administration" title="Organizer applications" description="Review applications and record approval decisions. Approved organizers can create groups immediately." />
      <div className="row row--between">
        <ChipGroup label="Application status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: "All" }, ...ORGANIZER_APPLICATION_STATUSES.map((s) => ({ value: s, label: presentStatus("organizer", s).label }))]} />
        <div style={{ flex: "1 1 220px", maxWidth: 360 }}><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name or email" /></div>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <DataTable columns={columns} rows={loading && !data ? undefined : data?.items} loading={loading} rowKey={(a) => a.id} caption="Organizer applications" compact
            empty={{ title: status === "PENDING" ? "No applications waiting for review" : "No applications found", description: search ? "Try a different search." : "New organizer applications will appear here." }} />
          {data && <Pagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} itemLabel="applications" />}
        </>
      )}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.applicant ?? "Application"}
        footer={selected && reviewable(selected) ? <><Button variant="danger-outline" disabled={!!busyId} onClick={() => reject(selected)}>Reject</Button><Button loading={busyId === selected.id} onClick={() => approve(selected)}>Approve</Button></> : undefined}>
        {selected && (
          <>
            <div className="row" style={{ gap: 12 }}><Avatar name={selected.applicant} size="lg" /><div><div className="text-strong">{selected.applicant}</div><StatusBadge kind="organizer" value={selected.status} /></div></div>
            <DescriptionList stack items={[
              { key: "Email", value: <a className="link" href={`mailto:${selected.email}`}>{selected.email}</a> },
              { key: "Phone", value: selected.phone || <span className="text-muted">Not provided</span> },
              { key: "Submitted", value: formatDateTime(selected.submittedAt) },
              { key: "Application ID", value: <code className="mono">{selected.id}</code> },
            ]} />
            <p className="text-xs text-muted">The full application text (address, reason, experience) is not exposed by the review API in this release.</p>
          </>
        )}
      </Drawer>
    </div>
  );
}
