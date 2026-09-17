"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ProtectedPage } from "@dhanvi/auth";
import { useAsyncData, formatDateTime, formatMoney, humanize, statusGuidance } from "@dhanvi/utils";
import { paymentService } from "@dhanvi/api-client";
import type { Payment } from "@dhanvi/types";
import { WorkflowStatusCard, PriorityStrip, paymentPriority, paymentSummary } from "../workflow";
import { PageHeader, Breadcrumbs, Badge, Button, Card, CardBody, CardHeader, ControlPanel, DataTable, Pagination, type Column, Callout, ErrorState, PageSkeleton, LinkButton, OverflowMenu } from "@dhanvi/ui";

const tone = (p: Payment) => p.status === "CAPTURED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(p.status) ? "danger" : p.status.startsWith("REFUND") ? "orange" : "neutral";
function PaymentStatus({ payment }: { payment: Payment }) { return <Badge tone={tone(payment)}>{statusGuidance("payment", payment.status).stage}</Badge>; }

export function PaymentsPage({ admin = false }: { admin?: boolean }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><Suspense fallback={<PageSkeleton />}><PaymentList admin={admin} /></Suspense></ProtectedPage>;
}
function PaymentList({ admin }: { admin: boolean }) {
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(params.get("status") ?? "");
  const data = useAsyncData(() => paymentService.list(admin, page, status || undefined), [admin, page, status]);
  const columns: Column<Payment>[] = [
    { key: "id", header: "Payment", primary: true, render: (p) => <Link className="link" href={`/payments/${p.id}`}>PAY-{p.id.slice(0, 8).toUpperCase()}</Link> },
    ...(admin ? [{ key: "member", header: "Member", render: (p: Payment) => p.memberName }] : []),
    { key: "group", header: "Group / cycle", render: (p) => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "status", header: "Status", render: (p) => <PaymentStatus payment={p} /> },
    ...(admin ? [{ key: "reconcile", header: "Reconciliation", render: (p: Payment) => <>{humanize(p.reconciliationStatus)}{p.reconciliationMessage && <span className="cell__sub">{p.reconciliationMessage}</span>}</> }] : []),
    { key: "date", header: "Created", render: (p) => formatDateTime(p.createdAt) },
    ...(admin ? [{ key: "actions", header: "", actions: true, render: (p: Payment) => p.status === "RECONCILIATION_REQUIRED" ? <LinkButton href={`/payments/${p.id}`} size="sm">Review reconciliation</LinkButton> : null }] : []),
  ];
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow={admin ? "Control center" : "Member"} title={admin ? "Payments" : "My payments"} description={admin ? "Incoming contribution payments. Only reconciliation issues need you; captured and matched payments settle on their own." : "Razorpay payments you started and where each one stands. Pay due contributions from Contributions."} badges={<Badge tone="info" plain>Razorpay test mode</Badge>} />
      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : (
        <>
          {admin && data.data && <PriorityStrip buckets={paymentPriority(data.data)} value={status} onChange={(s) => { setStatus(s); setPage(1); }} />}
          <Card>
            <DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={(p) => p.id} compact={admin} empty={{ title: status ? "No payments in this state" : "No payments yet", description: admin ? "Payments appear as soon as a member opens Checkout for an eligible contribution." : "When you pay a contribution through Razorpay it appears here with its verified status." }} />
            <CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payments" /></CardBody>
          </Card>
        </>
      )}
      {!admin && <p className="text-sm text-muted">Looking for posted ledger entries? See your <Link className="link" href="/ledger">financial history</Link>.</p>}
    </div>
  );
}

export function PaymentDetailsPage({ admin = false }: { admin?: boolean }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><Details admin={admin} /></ProtectedPage>;
}
function Details({ admin }: { admin: boolean }) {
  const { id } = useParams<{ id: string }>();
  const data = useAsyncData(() => paymentService.details(id, admin), [id, admin]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function reconcile() { setBusy(true); setError(""); try { await paymentService.refresh(id, admin); await data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Could not reconcile."); } finally { setBusy(false); } }
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <PageSkeleton />;
  const { payment: p, timeline, events, refunds } = data.data;
  const summary = paymentSummary(p, admin ? "admin" : "member");
  const needsAction = admin ? p.status === "RECONCILIATION_REQUIRED" || (p.status === "PENDING" && !!p.providerOrderId) : false;
  const memberCanCheck = !admin && ["PENDING", "AUTHORIZED"].includes(p.status) && !!p.providerOrderId;
  return (
    <div className="stack stack--lg">
      <Breadcrumbs items={[{ label: admin ? "Payments" : "My payments", href: "/payments" }, { label: `PAY-${p.id.slice(0, 8).toUpperCase()}` }]} />
      <PageHeader title={`Cycle ${p.cycleNumber} contribution · ${formatMoney(p.amount)}`} description={`${admin ? `${p.memberName} · ` : ""}${p.groupName} · Razorpay ${p.environment.toLowerCase()}`} badges={<PaymentStatus payment={p} />} />
      {admin ? (
        <ControlPanel eyebrow="Current stage" stage={summary.stage} status={summary.status} headline={summary.headline}
          facts={[...(summary.blockedBy ? [{ label: "Blocked by", value: summary.blockedBy, tone: "blocked" as const }] : []), ...(summary.waitingFor ? [{ label: "Waiting for", value: summary.waitingFor, tone: "waiting" as const }] : []), ...(summary.next ? [{ label: "Next", value: summary.next }] : [])]}
          primary={needsAction ? <Button onClick={reconcile} loading={busy}>{p.status === "RECONCILIATION_REQUIRED" ? "Reconcile with Razorpay" : "Check provider status"}</Button> : undefined}
          menu={<OverflowMenu items={[...(p.journalId ? [{ id: "journal", label: "View capture journal", href: `/ledger/journals/${p.journalId}` }] : []), ...(p.reversalJournalId ? [{ id: "reversal", label: "View refund reversal", href: `/ledger/journals/${p.reversalJournalId}` }] : []), ...(!needsAction && p.status !== "CAPTURED" ? [{ id: "refresh", label: "Refresh from Razorpay", onSelect: reconcile }] : [])]} label="More payment actions" />}>
          {!needsAction && <p className="wf-noaction" role="status" style={{ margin: 0 }}>{p.status === "CAPTURED" ? "Captured and matched. No action is required." : "No admin action is required at this stage."}</p>}
        </ControlPanel>
      ) : (
        <WorkflowStatusCard summary={{ ...summary, action: memberCanCheck ? { title: "Already paid? Check the gateway status", status: "waiting", responsibleRole: "SYSTEM", actionLabel: "Check status", onAction: reconcile } : summary.action }} viewer="member" title="Payment progress" stepperLabel="Payment steps" />
      )}
      {error && <Callout variant="danger" title="We couldn't check this payment">{error} {admin ? "Nothing changed." : "Your contribution has not been charged again."}</Callout>}
      <Card><CardBody><dl className="grid-2">{[
        ["Amount", formatMoney(p.amount)], ["Financial settlement", p.refundedAt ? "Refunded" : p.settledAt ? "Gateway settled (test)" : "Unsettled"],
        ...(admin ? [["Member", p.memberName], ["Reconciliation", humanize(p.reconciliationStatus)], ["Reconciliation note", p.reconciliationMessage ?? "—"], ["Last reconciled", p.lastReconciledAt ? formatDateTime(p.lastReconciledAt) : "—"]] : []),
        ["Created", formatDateTime(p.createdAt)], ["Captured", p.capturedAt ? formatDateTime(p.capturedAt) : "—"],
      ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
        {admin && <details><summary>Payment references</summary><dl className="stack">{[["Payment ID", p.id], ["Contribution", p.contributionId], ["Group", p.groupId], ["Cycle", p.cycleId], ["Membership", p.membershipId], ["Razorpay order", p.providerOrderId ?? "Pending"], ["Razorpay payment", p.providerPaymentId ?? "Pending"], ["Failure", p.failureReason ?? "—"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl></details>}
      </CardBody></Card>
      <Card><CardHeader title="Activity" subtitle="How this payment reached its current state" /><CardBody><ol className="stack">{[...timeline].reverse().map((t) => <li key={t.id}><span className="text-sm text-muted">{formatDateTime(t.createdAt)}</span><br /><strong>{humanize(t.action)}</strong><p className="text-muted text-sm">{t.message}</p></li>)}</ol></CardBody></Card>
      {admin && <Card><CardHeader title="Verified webhook events" /><DataTable rows={events} rowKey={(e) => e.id} compact columns={[{ key: "event", header: "Event", render: (e) => e.eventType }, { key: "status", header: "Processing", render: (e) => e.processingStatus }, { key: "received", header: "Received", render: (e) => formatDateTime(e.receivedAt) }]} empty={{ title: "No webhook events", description: "Only verified event summaries are retained." }} /></Card>}
      {refunds.length > 0 && <Card><CardHeader title="Refunds" /><DataTable rows={refunds} rowKey={(r) => r.id} compact columns={[{ key: "ref", header: "Refund", render: (r) => r.providerRefundId }, { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount) }, { key: "status", header: "Status", render: (r) => r.status }]} /></Card>}
    </div>
  );
}
