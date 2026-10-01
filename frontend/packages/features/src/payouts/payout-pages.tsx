"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type ReactNode } from "react";
import { ProtectedPage } from "@dhanvi/auth";
import { useAsyncData, formatDateTime, formatMoney, humanize, statusGuidance } from "@dhanvi/utils";
import { payoutService, enumParam } from "@dhanvi/api-client";
import type { Payout } from "@dhanvi/types";
import { WorkflowStatusCard, NextActionCard, PriorityStrip, approvable, effectiveStatus, payoutChecklist, payoutPriority, payoutSummary } from "../workflow";
import { adminService } from "@dhanvi/api-client";
import { PageHeader, Breadcrumbs, Badge, Button, Card, CardBody, CardHeader, ControlPanel, DataTable, Pagination, type Column, FormField, Input, Select, Callout, ErrorState, PageSkeleton, LinkButton, OverflowMenu, ResponsiveFilters, useConfirm } from "@dhanvi/ui";

const STATUSES = ["PENDING_BENEFICIARY", "APPROVAL_REQUIRED", "APPROVED", "PROCESSING", "PROVIDER_PENDING", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED", "CANCELLED"];
const tone = (s: string) => s === "SUCCEEDED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(s) ? "danger" : ["APPROVAL_REQUIRED", "APPROVED"].includes(s) ? "warning" : "neutral";
function Status({ p, member }: { p: Payout; member?: boolean }) {
  const status = effectiveStatus(p);
  const delayed = ["FAILED", "RECONCILIATION_REQUIRED"].includes(status);
  return <Badge tone={member && delayed ? "warning" : tone(status)}>{member && delayed ? "Delayed · under review" : statusGuidance("payout", status).stage}</Badge>;
}

/** `accountForm` is the member's bank-account form, supplied only by the member app so the admin bundle never carries it. */
export function PayoutsPage({ admin = false, organizer = false, accountForm }: { admin?: boolean; organizer?: boolean; accountForm?: ReactNode }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : organizer ? ["ORGANIZER"] : undefined}><Suspense fallback={<PageSkeleton />}><List admin={admin} organizer={organizer} accountForm={accountForm} /></Suspense></ProtectedPage>;
}
function List({ admin, organizer, accountForm }: { admin: boolean; organizer: boolean; accountForm?: ReactNode }) {
  const search = useSearchParams(), params = useParams<{ id: string }>();
  const [page, setPage] = useState(1), [status, setStatus] = useState(search.get("status") ?? ""), [type, setType] = useState("");
  const [group, setGroup] = useState(search.get("groupId") ?? ""), [cycle, setCycle] = useState(search.get("cycleId") ?? "");
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set("status", enumParam(status)); if (type) query.set("type", enumParam(type));
  if (group) query.set("groupId", group); if (cycle) query.set("cycleId", cycle);
  const qs = query.toString();
  const data = useAsyncData(() => organizer ? payoutService.group(params.id, page) : payoutService.list(admin, qs), [admin, organizer, params.id, page, qs]);
  const overview = useAsyncData(() => adminService.overview(), [qs], admin);
  const account = useAsyncData(payoutService.account, [], !admin && !organizer);
  const member = !admin && !organizer;
  const mine = member ? (data.data?.items ?? []).filter((p) => !["SUCCEEDED", "CANCELLED"].includes(p.status)) : [];
  const columns: Column<Payout>[] = [
    { key: "id", header: "Payout", primary: true, render: (p) => organizer ? <span>{humanize(p.payoutType)}</span> : <Link className="link" href={`/payouts/${p.id}`}>{humanize(p.payoutType)}</Link> },
    { key: "status", header: admin ? "Stage" : "Status", mobile: "status", render: (p) => <Status p={p} member={!admin} /> },
    { key: "amount", header: "Amount", align: "right", mobile: "emphasis", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    ...(member ? [] : [{ key: "recipient", header: "Recipient", render: (p: Payout) => p.memberName }]),
    { key: "group", header: "Group / cycle", render: (p) => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "created", header: "Created", mobile: "hidden", render: (p) => formatDateTime(p.createdAt) },
    ...(admin ? [{ key: "actions", header: "", actions: true, render: (p: Payout) => { const s = effectiveStatus(p); return ["APPROVAL_REQUIRED", "APPROVED", "FAILED", "RECONCILIATION_REQUIRED"].includes(s) ? <LinkButton href={`/payouts/${p.id}`} size="sm">{s === "APPROVAL_REQUIRED" ? "Review" : s === "APPROVED" ? "Execute" : s === "FAILED" ? "Retry" : "Reconcile"}</LinkButton> : s === "PENDING_BENEFICIARY" ? <span className="text-xs text-muted">Waiting on member</span> : null; } }] : []),
  ];
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow={admin ? "Control center" : organizer ? "Organizer" : "Member"} title={admin ? "Payouts" : organizer ? "Group payouts" : "My payouts"}
        description={admin ? "Approve destinations, execute transfers and resolve failures. Items waiting on members or the provider need nothing from you." : organizer ? "Dhanvi processes payouts; you can follow their status here." : "Your payout rights and auction benefits, and where each transfer stands."} badges={<Badge tone="info" plain>Fake test provider</Badge>}
      />
      {member && data.data && mine.length > 0 && (
        <div className="stack"><h2 className="h-section" style={{ margin: 0 }}>Where your payouts stand</h2>{mine.map((p) => { const s = payoutSummary(p, "member", account.data); return <NextActionCard key={p.id} viewer="member" action={s.action ?? { title: `${s.stage} · ${p.groupName} · cycle ${p.cycleNumber}`, description: <>{s.headline}{s.waitingFor && <> Waiting for {s.waitingFor}.</>}{s.next && <> <strong>Next:</strong> {s.next}</>}</>, status: s.status === "blocked" ? "waiting" : s.status, responsibleRole: s.responsibleRole, actionLabel: "View payout", actionHref: `/payouts/${p.id}`, since: p.createdAt }} />; })}</div>
      )}
      {admin && <PriorityStrip buckets={payoutPriority(overview.data?.payouts.counts)} value={status} onChange={(s) => { setStatus(s === "APPROVAL_REQUIRED" ? "PENDING_BENEFICIARY" : s); setPage(1); }} />}
      {admin && (
        <ResponsiveFilters label="Payout filters" title="Filter payouts" activeCount={[status, type, group, cycle].filter(Boolean).length} onClear={() => { setStatus(""); setType(""); setGroup(""); setCycle(""); setPage(1); }}>
          <FormField label="Status" htmlFor="payout-status"><Select id="payout-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></FormField>
          <FormField label="Type" htmlFor="payout-type"><Select id="payout-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{["WINNER_PAYOUT", "MEMBER_AUCTION_BENEFIT", "PLATFORM_FEE_SETTLEMENT"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></FormField>
          <FormField label="Group ID" htmlFor="payout-group"><Input id="payout-group" value={group} onChange={(e) => { setGroup(e.target.value); setPage(1); }} /></FormField>
          <FormField label="Cycle ID" htmlFor="payout-cycle"><Input id="payout-cycle" value={cycle} onChange={(e) => { setCycle(e.target.value); setPage(1); }} /></FormField>
        </ResponsiveFilters>
      )}
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      <Card>
        {member && <CardHeader title="Payout history" />}
        <DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={(p) => p.id} compact={admin} empty={admin ? { title: status ? "No payouts in this state" : "No payouts yet", description: status ? "Clear the filter to see every payout." : "Payout obligations appear after a completed selection is prepared from its group page." } : { title: "No payouts yet", description: organizer ? "Payouts for this group appear after a cycle selection completes and Dhanvi prepares them." : "Your payouts appear here after you are selected in a cycle." }} />
        <CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payouts" /></CardBody>
      </Card>
      {member && accountForm && <div id="payout-account">{accountForm}</div>}
    </div>
  );
}

export function PayoutDetailsPage({ admin = false }: { admin?: boolean }) { return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><Details admin={admin} /></ProtectedPage>; }
function Details({ admin }: { admin: boolean }) {
  const { id } = useParams<{ id: string }>();
  const data = useAsyncData(() => payoutService.details(id, admin), [id, admin]);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const keys = useRef<Record<string, string>>({});
  async function act(action: "approve" | "execute" | "retry" | "reconcile") {
    const p = data.data?.payout; if (!p) return;
    const prompts = {
      approve: { title: "Approve this payout destination?", description: `${formatMoney(p.amount)} to ${p.memberName}${p.maskedAccountNumber ? ` · account ending ${p.maskedAccountNumber.slice(-4)}` : ""}. The transfer is executed as a separate step.`, confirmLabel: "Approve payout" },
      execute: { title: "Execute this payout?", description: `Sends ${formatMoney(p.amount)} to the provider for ${p.memberName}. Provider confirmation follows; this cannot be undone.`, confirmLabel: "Execute payout" },
      retry: { title: "Retry the failed payout?", description: `A new provider attempt for ${formatMoney(p.amount)} to ${p.memberName}.`, confirmLabel: "Retry payout" },
      reconcile: { title: "Reconcile with the provider?", description: "Fetches the provider's latest status and records the observation.", confirmLabel: "Reconcile" },
    } as const;
    const r = await confirm(prompts[action]); if (!r.confirmed) return;
    setBusy(true); setError(""); const scope = `${action}:${data.data?.attempts.length ?? 0}`; keys.current[scope] ??= crypto.randomUUID();
    try { await payoutService.action(id, action, keys.current[scope]); await data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Payout operation failed."); } finally { setBusy(false); }
  }
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />; if (!data.data) return <PageSkeleton />;
  const { payout: p, attempts, timeline, events } = data.data;
  const checklist = payoutChecklist(p);
  const summary = payoutSummary(p, admin ? "admin" : "member");
  const fee = p.payoutType === "PLATFORM_FEE_SETTLEMENT";
  // Exactly one valid command per stage. Nothing for stages the backend would reject.
  const primary = !admin || fee ? null : approvable(p) ? { action: "approve" as const, label: "Approve payout" } : p.status === "APPROVED" ? { action: "execute" as const, label: "Execute payout" } : p.status === "FAILED" ? { action: "retry" as const, label: "Retry payout" } : ["PROCESSING", "PROVIDER_PENDING", "RECONCILIATION_REQUIRED"].includes(p.status) ? { action: "reconcile" as const, label: "Reconcile provider status" } : null;
  const delayed = ["FAILED", "RECONCILIATION_REQUIRED"].includes(p.status);
  return (
    <div className="stack stack--lg">
      <Breadcrumbs items={[{ label: admin ? "Payouts" : "My payouts", href: "/payouts" }, { label: `${p.groupName} · Cycle ${p.cycleNumber}` }, { label: humanize(p.payoutType) }]} />
      <PageHeader title={`${humanize(p.payoutType)} · ${formatMoney(p.amount)}`} description={`${admin ? `${p.memberName} · ` : ""}${p.groupName} · Cycle ${p.cycleNumber}`} badges={<Status p={p} member={!admin} />} />
      {admin ? (
        <ControlPanel eyebrow="Current stage" stage={summary.stage} status={summary.status} headline={summary.headline}
          facts={[...(summary.blockedBy ? [{ label: "Blocked by", value: summary.blockedBy, tone: "blocked" as const }] : []), ...(summary.waitingFor ? [{ label: "Waiting for", value: summary.waitingFor, tone: "waiting" as const }] : []), ...(summary.next ? [{ label: "Next", value: summary.next }] : [])]}
          primary={primary ? <Button loading={busy} onClick={() => act(primary.action)}>{primary.label}</Button> : undefined}
          menu={<OverflowMenu label="More payout actions" items={[{ id: "alloc", label: "Funded allocation journal", href: `/ledger/journals/${p.allocationJournalId}` }, ...(p.settlementJournalId ? [{ id: "settle", label: "Settlement journal", href: `/ledger/journals/${p.settlementJournalId}` }] : []), { id: "group", label: "Open group", href: `/groups/${p.groupId}?tab=payouts` }]} />}>
          <ul className="wf-checklist" style={{ margin: 0 }}>{checklist.map((c) => <li key={c.label} className={c.done ? "wf-checklist__item wf-checklist__item--done" : "wf-checklist__item"}><span aria-hidden>{c.done ? "✓" : "○"}</span><span><strong>{c.label}</strong>{c.hint && <span className="text-sm text-muted"> · {c.hint}</span>}</span><span className="sr-only">{c.done ? "done" : "pending"}</span></li>)}</ul>
          {!primary && <p className="wf-noaction" role="status" style={{ margin: 0 }}>{p.status === "SUCCEEDED" ? "Settled. No action is required." : p.status === "PENDING_BENEFICIARY" ? "Approval becomes available once the recipient's payout bank account is usable (new accounts have a 24-hour hold)." : "No admin action is required at this stage."}</p>}
        </ControlPanel>
      ) : delayed ? (
        <Callout variant="warning" title="Your payout is delayed">Dhanvi is reviewing the transfer. No action is required from you; the status updates here once it is resolved.</Callout>
      ) : (
        <WorkflowStatusCard summary={summary} viewer="member" title="Payout progress" stepperLabel="Payout steps" />
      )}
      {error && <Callout variant="danger" title="The payout operation didn't complete">{error} Nothing was changed; review the status and try again.</Callout>}
      <Card><CardBody><dl className="grid-2">{[["Recipient", p.memberName], ["Type", humanize(p.payoutType)], ["Amount", formatMoney(p.amount)], ["Destination", p.maskedAccountNumber ?? (fee ? "Internal accounting allocation" : "Awaiting payout account")], ["Created", formatDateTime(p.createdAt)], ["Approved", p.approvedAt ? formatDateTime(p.approvedAt) : "—"], ["Settled", p.settledAt ? formatDateTime(p.settledAt) : "—"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
        {admin && <details><summary>Immutable source references</summary><p className="text-sm">Selection: <code className="mono">{p.selectionResultId}</code></p>{p.auctionResultId && <p className="text-sm">Auction result: <code className="mono">{p.auctionResultId}</code></p>}</details>}</CardBody></Card>
      {admin && <Card><CardHeader title="Provider attempts" /><DataTable rows={attempts} rowKey={(a) => a.id} compact columns={[{ key: "number", header: "Attempt", render: (a) => a.attemptNumber }, { key: "destination", header: "Destination", render: (a) => a.maskedAccountNumber }, { key: "ref", header: "Provider reference", render: (a) => a.providerPayoutId }, { key: "status", header: "Status", render: (a) => <>{humanize(a.status)}{a.failureCode && <span className="cell__sub">{a.failureCode}</span>}</> }, { key: "date", header: "Requested", render: (a) => formatDateTime(a.requestedAt) }]} empty={{ title: "No outgoing attempt yet" }} /></Card>}
      <Card><CardHeader title="Activity" subtitle="How this payout reached its current state" /><CardBody><ol className="stack">{[...timeline].reverse().map((t) => <li key={t.id}><span className="text-sm text-muted">{formatDateTime(t.createdAt)}</span><br /><strong>{humanize(t.action)}</strong><p className="text-muted text-sm">{t.message}</p></li>)}</ol></CardBody></Card>
      {admin && events.length > 0 && <Card><CardHeader title="Provider reconciliation events" /><DataTable rows={events} rowKey={(e) => e.id} compact columns={[{ key: "event", header: "Reference", render: (e) => e.providerEventId }, { key: "status", header: "Provider status", render: (e) => humanize(e.status) }, { key: "match", header: "Matched", render: (e) => e.matched ? "Yes" : "Review required" }, { key: "at", header: "Received", render: (e) => formatDateTime(e.receivedAt) }]} /></Card>}
    </div>
  );
}
