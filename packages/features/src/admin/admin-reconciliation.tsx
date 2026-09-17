"use client";
import Link from "next/link";
import { ProtectedPage } from "@dhanvi/auth";
import { paymentService, payoutService, enumParam } from "@dhanvi/api-client";
import type { Payment, Payout } from "@dhanvi/types";
import { useAsyncData, formatDateTime, formatMoney, humanize } from "@dhanvi/utils";
import { PageHeader, Card, CardHeader, DataTable, type Column, ErrorState, LinkButton, Badge } from "@dhanvi/ui";

export function AdminReconciliationPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><Reconciliation /></ProtectedPage>;
}

/** Exception queue: only payments and payouts whose provider data disagrees with Dhanvi's record. */
function Reconciliation() {
  const payments = useAsyncData(() => paymentService.list(true, 1, "RECONCILIATION_REQUIRED"), []);
  const payouts = useAsyncData(() => payoutService.list(true, `page=1&status=${enumParam("RECONCILIATION_REQUIRED")}`), []);
  const paymentColumns: Column<Payment>[] = [
    { key: "id", header: "Payment", primary: true, render: (p) => <Link className="link" href={`/payments/${p.id}`}>PAY-{p.id.slice(0, 8).toUpperCase()}</Link> },
    { key: "member", header: "Member", render: (p) => <>{p.memberName}<span className="cell__sub">{p.groupName} · cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "note", header: "Mismatch", render: (p) => p.reconciliationMessage ?? humanize(p.reconciliationStatus) },
    { key: "since", header: "Since", render: (p) => formatDateTime(p.lastReconciledAt ?? p.createdAt) },
    { key: "actions", header: "", actions: true, render: (p) => <LinkButton href={`/payments/${p.id}`} size="sm">Review payment</LinkButton> },
  ];
  const payoutColumns: Column<Payout>[] = [
    { key: "id", header: "Payout", primary: true, render: (p) => <Link className="link" href={`/payouts/${p.id}`}>{humanize(p.payoutType)}</Link> },
    { key: "recipient", header: "Recipient", render: (p) => <>{p.memberName}<span className="cell__sub">{p.groupName} · cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "status", header: "Status", render: (p) => <Badge tone="danger">{humanize(p.status)}</Badge> },
    { key: "since", header: "Since", render: (p) => formatDateTime(p.createdAt) },
    { key: "actions", header: "", actions: true, render: (p) => <LinkButton href={`/payouts/${p.id}`} size="sm">Review payout</LinkButton> },
  ];
  const total = (payments.data?.totalCount ?? 0) + (payouts.data?.totalCount ?? 0);
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Control center" title="Reconciliation" description={payments.data && payouts.data ? (total ? `${total} item${total === 1 ? "" : "s"} where provider data does not match Dhanvi's record.` : "Every payment and payout matches provider data. Nothing to reconcile.") : "Payments and payouts the provider disagrees with."} />
      <Card>
        <CardHeader title="Payments" subtitle="Contributions stay unsettled until reviewed" />
        {payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> : <DataTable columns={paymentColumns} rows={payments.data?.items} loading={payments.loading} rowKey={(p) => p.id} compact empty={{ title: "No payment mismatches", description: "Captured and matched payments need no action." }} />}
      </Card>
      <Card>
        <CardHeader title="Payouts" subtitle="Settlement and retries are blocked until reviewed" />
        {payouts.error ? <ErrorState message={payouts.error} onRetry={payouts.reload} /> : <DataTable columns={payoutColumns} rows={payouts.data?.items} loading={payouts.loading} rowKey={(p) => p.id} compact empty={{ title: "No payout mismatches", description: "All provider observations match." }} />}
      </Card>
    </div>
  );
}
