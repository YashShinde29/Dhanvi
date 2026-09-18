"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedPage } from "@dhanvi/auth";
import { contributionService } from "@dhanvi/api-client";
import type { Contribution } from "@dhanvi/types";
import { PaymentCheckout } from "../payments/payment-checkout";
import { useAsyncData, formatDate, formatMoney, CONTRIBUTION_STATUSES, presentStatus } from "@dhanvi/utils";
import { PageHeader, ChipGroup, DataTable, Pagination, type Column, StatusBadge, Callout, ErrorState, LinkButton, Icons, PageSkeleton } from "@dhanvi/ui";

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
    // Phone card: group + cycle, status, then the amount large, due date, and the Pay action last. Bookkeeping columns stay desktop-only.
    { key: "group", header: "Group", primary: true, render: (c) => <><Link className="link" href={`/groups/${c.groupId}`}>{c.groupName}</Link><span className="cell__sub">Cycle {c.cycleNumber}</span></> },
    { key: "status", header: "Status", mobile: "status", render: (c) => <StatusBadge kind="contribution" value={c.status} /> },
    { key: "expected", header: "Expected", align: "right", mobile: "emphasis", render: (c) => <span className="amount">{formatMoney(c.expectedAmount)}</span> },
    { key: "due", header: "Due date", render: (c) => formatDate(c.dueDate) },
    { key: "recorded", header: "Recorded", align: "right", render: (c) => <span className="amount" style={{ fontWeight: 500 }}>{formatMoney(c.recordedAmount)}</span> },
    { key: "recordedAt", header: "Recorded on", mobile: "hidden", render: (c) => c.recordedAt ? formatDate(c.recordedAt, c.groupTimeZone) : <span className="text-muted">—</span> },
    { key: "payment", header: "Payment", actions: true, className: "cell--payment", render: (c) => c.collectionMode === "RAZORPAY" ? <PaymentCheckout contributionId={c.id} groupName={c.groupName} cycleNumber={c.cycleNumber} dueDate={c.dueDate} /> : <span className="text-muted text-sm">Manual tracking</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Member" title="My contributions" description="Pay and track your monthly contribution for each group. Each row shows what is due, what is settled, and your next action."
        actions={groupId && <LinkButton href="/contributions" variant="secondary" size="sm">Show all groups</LinkButton>} />
      <Callout variant="neutral">Manual records track reported contributions. Eligible platform groups collect through Razorpay Test Checkout; only verified captures count as gateway settlement.</Callout>
      <ChipGroup scroll label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: "All" }, ...CONTRIBUTION_STATUSES.map((s) => ({ value: s, label: presentStatus("contribution", s).label }))]} />
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
