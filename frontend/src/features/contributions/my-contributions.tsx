"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { contributionService } from "@/services/contribution.service";
import type { Contribution } from "@/types/contribution";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader } from "@/components/ui/page-header";
import { ChipGroup } from "@/components/ui/filter-bar";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { Callout, ErrorState } from "@/components/ui/callout";
import { LinkButton } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoney } from "@/lib/format";
import { CONTRIBUTION_STATUSES, presentStatus } from "@/lib/status";

export function MyContributionsPage() {
  return <ProtectedPage><Suspense fallback={<PageSkeleton />}><History /></Suspense></ProtectedPage>;
}

function History() {
  const groupId = useSearchParams().get("groupId");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (groupId) params.set("groupId", groupId);
    return params.toString();
  }, [page, status, groupId]);
  const { data, error, loading, reload } = useAsyncData(() => contributionService.mine(query), [query]);

  const columns: Column<Contribution>[] = [
    { key: "group", header: "Group", primary: true, render: (c) => <><Link className="link" href={`/groups/${c.groupId}`}>{c.groupName}</Link><span className="cell__sub">Cycle {c.cycleNumber}</span></> },
    { key: "due", header: "Due date", render: (c) => formatDate(c.dueDate) },
    { key: "expected", header: "Expected", align: "right", render: (c) => <span className="amount">{formatMoney(c.expectedAmount)}</span> },
    { key: "recorded", header: "Recorded", align: "right", render: (c) => <span className="amount" style={{ fontWeight: 500 }}>{formatMoney(c.recordedAmount)}</span> },
    { key: "recordedAt", header: "Recorded on", render: (c) => c.recordedAt ? formatDate(c.recordedAt, c.groupTimeZone) : <span className="text-muted">—</span> },
    { key: "status", header: "Status", render: (c) => <StatusBadge kind="contribution" value={c.status} /> },
  ];

  return (
    <>
      <PageHeader eyebrow="Member" title="My contributions" description="Your expected monthly obligations and what has been recorded for each cycle."
        actions={groupId && <LinkButton href="/contributions" variant="secondary" size="sm">Show all groups</LinkButton>} />
      <Callout variant="neutral">Contributions are recorded by the organizer or platform as operational records. Dhanvi does not process payments at this stage.</Callout>
      <ChipGroup label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: "All" }, ...CONTRIBUTION_STATUSES.map((s) => ({ value: s, label: presentStatus("contribution", s).label }))]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <DataTable columns={columns} rows={loading && !data ? undefined : data?.items} loading={loading} rowKey={(c) => c.id} caption="Contribution history"
            empty={{ title: status ? "No contributions with this status" : "No contributions yet", description: status ? "Try another status filter." : "Once you're an active member of a group, each cycle's contribution will appear here.", action: !status ? <LinkButton href="/groups" variant="secondary" icon={<Icons.Search size={16} />}>Browse groups</LinkButton> : undefined }} />
          {data && <Pagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} itemLabel="contributions" />}
        </>
      )}
    </>
  );
}
