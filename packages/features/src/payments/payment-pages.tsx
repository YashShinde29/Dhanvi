"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProtectedPage } from "@dhanvi/auth";
import { useAsyncData, formatDateTime, formatMoney, humanize } from "@dhanvi/utils";
import { paymentService } from "@dhanvi/api-client";
import type { Payment } from "@dhanvi/types";
import { WorkflowStatusCard, PriorityStrip, paymentPriority, paymentSummary } from "../workflow";
import { PageHeader, Breadcrumbs, Badge, Button, LinkButton, Card, CardBody, CardHeader, DataTable, Pagination, type Column, StatCard, Callout, ErrorState, PageSkeleton } from "@dhanvi/ui";

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
    { key: "id", header: "Payment", primary: true, render: p => <Link className="link" href={`/payments/${p.id}`}>{p.id.slice(0, 8)}</Link> },
    ...(admin ? [{ key: "member", header: "Member", render: (p: Payment) => p.memberName }] : []),
    { key: "group", header: "Group / Cycle", render: p => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: p => formatMoney(p.amount) },
    { key: "provider", header: "Provider", render: p => <>{p.provider}<span className="cell__sub">{p.providerPaymentId ?? "Awaiting payment"}</span></> },
    { key: "status", header: "Status", render: p => <PaymentStatus payment={p} /> },
    { key: "reconcile", header: "Reconciliation", render: p => humanize(p.reconciliationStatus) },
    { key: "date", header: "Created", render: p => formatDateTime(p.createdAt) },
  ];
  return <div className="stack stack--lg"><PageHeader title={admin ? "Payments" : "My payments"} description={admin ? "Incoming contribution payments. Reconciliation-required items need your review; pending items are waiting for Razorpay." : "Every Razorpay payment you started, with its verified status. Pay contributions from the Contributions page."} actions={<Badge tone="info">Razorpay Test Mode</Badge>} />
    <Callout variant="info">Test transactions only. Gateway capture does not mean a bank settlement or a payout.</Callout>
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <>
      {admin && data.data && <PriorityStrip buckets={paymentPriority(data.data)} />}
      {admin && data.data && data.data.reconciliationRequired > 0 && <Callout variant="warning" title={`${data.data.reconciliationRequired} payment${data.data.reconciliationRequired === 1 ? "" : "s"} need reconciliation`}>Provider data did not match Dhanvi&apos;s record. Open the payment and reconcile; nothing changes until you do.</Callout>}
      {admin && data.data && <div className="grid-4"><StatCard label="Total payments" value={data.data.totalCount} /><StatCard label="Captured" value={data.data.captured} /><StatCard label="Pending" value={data.data.pending} /><StatCard label="Failed" value={data.data.failed} /></div>}
      <Card><CardHeader title="Payment history" /><DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={p => p.id} empty={{ title: "No payments yet", description: admin ? "Payments appear here as soon as a member opens Checkout for an eligible contribution." : "When you pay a contribution through Razorpay, it appears here with its verification status. Outstanding contributions are on the Contributions page." }} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payments" /></CardBody></Card>
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
  return <div className="stack stack--lg"><Breadcrumbs items={[{ label: admin ? "Payments" : "My payments", href: "/payments" }, { label: `PAY-${p.id.slice(0, 8).toUpperCase()}` }]} />
    <PageHeader title={`Cycle ${p.cycleNumber} contribution payment`} description={`${p.memberName} · ${p.groupName} · ${formatMoney(p.amount)} via Razorpay`} actions={<Badge tone="info">Razorpay Test Mode</Badge>} />
    <WorkflowStatusCard summary={paymentSummary(p, admin ? "admin" : "member")} viewer={admin ? "admin" : "member"} title="Payment progress" stepperLabel="Payment steps" />
    <div className="row"><LinkButton href="/payments" variant="secondary">Payment history</LinkButton><Button onClick={reconcile} loading={busy}>{admin ? "Reconcile with Razorpay" : "Check gateway status"}</Button><PaymentStatus payment={p} /></div>
    {error && <Callout variant="danger" title="We couldn't check this payment">{error} Your contribution has not been charged again.</Callout>}
    <Card><CardBody><dl className="grid-2">{[
      ["Amount", formatMoney(p.amount)], ["Financial settlement", p.refundedAt ? "Refunded" : p.settledAt ? "Gateway settled (test)" : "Unsettled"],
      ["Member", p.memberName], ["Provider", p.provider], ["Currency", p.currency], ["Created", formatDateTime(p.createdAt)],
      ["Reconciliation", humanize(p.reconciliationStatus)], ["Reconciliation note", p.reconciliationMessage ?? "Awaiting confirmation"],
    ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
      <details><summary>Payment references</summary><dl className="stack">{[["Payment ID", p.id], ["Contribution", p.contributionId], ["Group", p.groupId], ["Cycle", p.cycleId], ["Membership", p.membershipId], ["Razorpay order", p.providerOrderId ?? "Pending"], ["Razorpay payment", p.providerPaymentId ?? "Pending"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl></details>
      {admin && p.journalId && <p><Link className="link" href={`/ledger/journals/${p.journalId}`}>View capture journal</Link></p>}
      {admin && p.reversalJournalId && <p><Link className="link" href={`/ledger/journals/${p.reversalJournalId}`}>View refund reversal</Link></p>}
    </CardBody></Card>
    <Card><CardHeader title="Activity" subtitle="How this payment reached its current state" /><CardBody><ol className="stack">{[...timeline].reverse().map(t => <li key={t.id}><span className="text-sm text-muted">{formatDateTime(t.createdAt)}</span><br /><strong>{humanize(t.action)}</strong><p className="text-muted text-sm">{t.message}</p></li>)}</ol></CardBody></Card>
    {admin && <Card><CardHeader title="Verified webhook events" /><DataTable rows={events} rowKey={e => e.id} columns={[
      { key: "event", header: "Event", render: e => e.eventType }, { key: "status", header: "Processing", render: e => e.processingStatus }, { key: "received", header: "Received", render: e => formatDateTime(e.receivedAt) },
    ]} empty={{ title: "No webhook events", description: "Only verified event summaries are retained." }} /></Card>}
    {refunds.length > 0 && <Card><CardHeader title="Refund observations" /><DataTable rows={refunds} rowKey={r => r.id} columns={[
      { key: "ref", header: "Refund", render: r => r.providerRefundId }, { key: "amount", header: "Amount", render: r => formatMoney(r.amount) }, { key: "status", header: "Status", render: r => r.status },
    ]} /></Card>}
  </div>;
}
