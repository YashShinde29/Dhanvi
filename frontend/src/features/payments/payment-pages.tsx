"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAsyncData } from "@/hooks/use-async-data";
import { paymentService } from "@/services/payment.service";
import type { Payment } from "@/types/payment";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { Callout, ErrorState } from "@/components/ui/callout";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatMoney, humanize } from "@/lib/format";

function PaymentStatus({ payment }: { payment: Payment }) {
  return <Badge tone={payment.status === "CAPTURED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(payment.status) ? "danger" : "neutral"}>{humanize(payment.status)}</Badge>;
}
export function PaymentsPage({ admin = false }: { admin?: boolean }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><PaymentList admin={admin} /></ProtectedPage>;
}
function PaymentList({ admin }: { admin: boolean }) {
  const [page, setPage] = useState(1);
  const data = useAsyncData(() => paymentService.list(admin, page), [admin, page]);
  const columns: Column<Payment>[] = [
    { key: "id", header: "Payment", primary: true, render: p => <Link className="link" href={`${admin ? "/admin" : ""}/payments/${p.id}`}>{p.id.slice(0, 8)}</Link> },
    ...(admin ? [{ key: "member", header: "Member", render: (p: Payment) => p.memberName }] : []),
    { key: "group", header: "Group / Cycle", render: p => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: p => formatMoney(p.amount) },
    { key: "provider", header: "Provider", render: p => <>{p.provider}<span className="cell__sub">{p.providerPaymentId ?? "Awaiting payment"}</span></> },
    { key: "status", header: "Status", render: p => <PaymentStatus payment={p} /> },
    { key: "reconcile", header: "Reconciliation", render: p => humanize(p.reconciliationStatus) },
    { key: "date", header: "Created", render: p => formatDateTime(p.createdAt) },
  ];
  return <div className="stack stack--lg"><PageHeader title={admin ? "Payments" : "My payments"} description="Incoming contribution payments and their verified gateway status." actions={<Badge tone="info">Razorpay Test Mode</Badge>} />
    <Callout variant="info">Test transactions only. Gateway capture does not mean a bank settlement or a payout.</Callout>
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <>
      {admin && data.data && <div className="grid-4"><StatCard label="Total payments" value={data.data.totalCount} /><StatCard label="Captured" value={data.data.captured} /><StatCard label="Pending" value={data.data.pending} /><StatCard label="Failed" value={data.data.failed} /><StatCard label="Reconciliation required" value={data.data.reconciliationRequired} /></div>}
      <Card><CardHeader title="Payment history" /><DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={p => p.id} empty={{ title: "No payments yet", description: "Razorpay Test payments appear here when a member opens checkout for an eligible contribution." }} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payments" /></CardBody></Card>
    </>}</div>;
}
export function PaymentDetailsPage({ admin = false }: { admin?: boolean }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><Details admin={admin} /></ProtectedPage>;
}
function Details({ admin }: { admin: boolean }) {
  const { id } = useParams<{ id: string }>();
  const data = useAsyncData(() => paymentService.details(id, admin), [id, admin]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function reconcile() { setBusy(true); setError(""); try { await paymentService.refresh(id, admin); data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Could not reconcile."); } finally { setBusy(false); } }
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <PageSkeleton />;
  const { payment: p, timeline, events, refunds } = data.data;
  return <div className="stack stack--lg"><PageHeader title="Payment details" description={`${p.groupName} · Cycle ${p.cycleNumber}`} actions={<Badge tone="info">Razorpay Test Mode</Badge>} />
    <div className="row"><LinkButton href={admin ? "/admin/payments" : "/payments"} variant="secondary">Payment history</LinkButton><Button onClick={reconcile} loading={busy}>{admin ? "Reconcile with Razorpay" : "Check gateway status"}</Button><PaymentStatus payment={p} /></div>
    {error && <Callout variant="danger">{error}</Callout>}
    <Card><CardBody><dl className="grid-2">{[
      ["Amount", formatMoney(p.amount)], ["Financial settlement", p.refundedAt ? "Refunded" : p.settledAt ? "Gateway settled (test)" : "Unsettled"],
      ["Member", p.memberName], ["Provider", p.provider], ["Currency", p.currency], ["Created", formatDateTime(p.createdAt)],
      ["Reconciliation", humanize(p.reconciliationStatus)], ["Reconciliation note", p.reconciliationMessage ?? "Awaiting confirmation"],
    ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
      <details><summary>Payment references</summary><dl className="stack">{[["Payment ID", p.id], ["Contribution", p.contributionId], ["Group", p.groupId], ["Cycle", p.cycleId], ["Membership", p.membershipId], ["Razorpay order", p.providerOrderId ?? "Pending"], ["Razorpay payment", p.providerPaymentId ?? "Pending"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl></details>
      {admin && p.journalId && <p><Link className="link" href={`/admin/ledger/journals/${p.journalId}`}>View capture journal</Link></p>}
      {admin && p.reversalJournalId && <p><Link className="link" href={`/admin/ledger/journals/${p.reversalJournalId}`}>View refund reversal</Link></p>}
    </CardBody></Card>
    <Card><CardHeader title="Timeline" /><CardBody><ol className="stack">{timeline.map(t => <li key={t.id}><strong>{humanize(t.action)}</strong> · {formatDateTime(t.createdAt)}<p className="text-muted">{t.message}</p></li>)}</ol></CardBody></Card>
    {admin && <Card><CardHeader title="Verified webhook events" /><DataTable rows={events} rowKey={e => e.id} columns={[
      { key: "event", header: "Event", render: e => e.eventType }, { key: "status", header: "Processing", render: e => e.processingStatus }, { key: "received", header: "Received", render: e => formatDateTime(e.receivedAt) },
    ]} empty={{ title: "No webhook events", description: "Only verified event summaries are retained." }} /></Card>}
    {refunds.length > 0 && <Card><CardHeader title="Refund observations" /><DataTable rows={refunds} rowKey={r => r.id} columns={[
      { key: "ref", header: "Refund", render: r => r.providerRefundId }, { key: "amount", header: "Amount", render: r => formatMoney(r.amount) }, { key: "status", header: "Status", render: r => r.status },
    ]} /></Card>}
  </div>;
}
