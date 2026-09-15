"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { ProtectedPage } from "@dhanvi/auth";
import { useAsyncData, formatDateTime, formatMoney, humanize } from "@dhanvi/utils";
import { payoutService } from "@dhanvi/api-client";
import type { Payout } from "@dhanvi/types";
import { WorkflowStatusCard, NextActionCard, PriorityStrip, UnavailableAction, payoutChecklist, payoutPriority, payoutSummary } from "../workflow";
import { PageHeader, Breadcrumbs, Badge, Button, LinkButton, Card, CardBody, CardHeader, DataTable, Pagination, type Column, FormField, Input, Select, StatCard, Callout, ErrorState, PageSkeleton } from "@dhanvi/ui";
import { PayoutAccountForm } from "./payout-account";
const statuses = ["PENDING_BENEFICIARY", "APPROVED", "PROCESSING", "PROVIDER_PENDING", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED"];
function Status({ p }: { p: Payout }) { return <Badge tone={p.status === "SUCCEEDED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(p.status) ? "danger" : "neutral"}>{humanize(p.status)}</Badge>; }
export function PayoutsPage({ admin = false, organizer = false }: { admin?: boolean; organizer?: boolean }) {
  return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : organizer ? ["ORGANIZER"] : undefined}><List admin={admin} organizer={organizer} /></ProtectedPage>;
}
function List({ admin, organizer }: { admin: boolean; organizer: boolean }) {
  const search = useSearchParams(), params = useParams<{ id: string }>();
  const [page, setPage] = useState(1), [status, setStatus] = useState(""), [type, setType] = useState("");
  const [group, setGroup] = useState(search.get("groupId") ?? ""), [cycle, setCycle] = useState(search.get("cycleId") ?? ""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set("status", status.replaceAll("_", "")); if (type) query.set("type", type.replaceAll("_", ""));
  if (group) query.set("groupId", group); if (cycle) query.set("cycleId", cycle);
  if (from) query.set("from", `${from}T00:00:00Z`); if (to) query.set("to", `${to}T00:00:00Z`);
  const qs = query.toString();
  const data = useAsyncData(() => organizer ? payoutService.group(params.id, page) : payoutService.list(admin, qs), [admin, organizer, params.id, page, qs]);
  const account = useAsyncData(payoutService.account, [], !admin && !organizer);
  const mine = !admin && !organizer ? (data.data?.items ?? []).filter(p => !["SUCCEEDED", "CANCELLED"].includes(p.status)) : [];
  async function prepare() { setBusy(true); setError(""); try { await payoutService.prepare(cycle); data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare settlement."); } finally { setBusy(false); } }
  const columns: Column<Payout>[] = [
    { key: "id", header: "Payout", primary: true, render: p => organizer ? p.id.slice(0, 8) : <Link className="link" href={`/payouts/${p.id}`}>{p.id.slice(0, 8)}</Link> },
    { key: "recipient", header: "Recipient", render: p => p.memberName },
    { key: "group", header: "Group / Cycle", render: p => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "type", header: "Type", render: p => humanize(p.payoutType) },
    { key: "amount", header: "Amount", align: "right", render: p => formatMoney(p.amount) },
    { key: "status", header: "Status", render: p => <Status p={p} /> },
    { key: "provider", header: "Provider", render: p => p.payoutType === "PLATFORM_FEE_SETTLEMENT" ? "Internal allocation" : "Fake test provider" },
    { key: "created", header: "Created", render: p => formatDateTime(p.createdAt) },
  ];
  return <div className="stack stack--lg"><PageHeader title={admin ? "Payout operations" : organizer ? "Group payouts" : "My payouts"} description={admin ? "Approve destinations, execute transfers and resolve failures. Items waiting on members or the provider need no action from you." : organizer ? "Transfer status for this group's payout rights and auction benefits. Dhanvi processes payouts; organizers monitor." : "Your payout rights and auction benefits, and where each transfer stands."} actions={<Badge tone="info">Fake Test Mode</Badge>} />
    <Callout variant="info">Selection establishes a payout right. A successful test settlement appears only after provider reconciliation. No real money is transferred.</Callout>
    {!admin && !organizer && data.data && (mine.length > 0 ? <div className="stack"><h2 className="h-section">Where your payouts stand</h2>{mine.map(p => { const s = payoutSummary(p, "member", account.data); return <NextActionCard key={p.id} viewer="member" action={s.action ?? { title: `${s.stage} · ${p.groupName} · cycle ${p.cycleNumber}`, description: <>{s.headline}{s.waitingFor && <> Waiting for {s.waitingFor}.</>}{s.next && <> <strong>Next:</strong> {s.next}</>}</>, status: s.status, responsibleRole: s.responsibleRole, actionLabel: "View payout", actionHref: `/payouts/${p.id}`, since: p.createdAt }} />; })}</div> : null)}
    {admin && <PriorityStrip buckets={payoutPriority(data.data?.summary)} value={status} onChange={s => { setStatus(s === "PROCESSING" ? "PROCESSING" : s); setPage(1); }} />}
    {admin && <div className="grid-3">{["PENDING_BENEFICIARY", "APPROVED", "PROCESSING", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED"].map(s => <StatCard key={s} label={s === "PENDING_BENEFICIARY" ? "Awaiting account / approval" : s === "APPROVED" ? "Ready to execute" : humanize(s)} value={(data.data?.summary?.[s] ?? 0) + (s === "PROCESSING" ? data.data?.summary?.PROVIDER_PENDING ?? 0 : 0)} />)}</div>}
    {!organizer && <Card><CardBody className="stack"><div className="grid-2"><FormField label="Payout type" htmlFor="payout-type"><Select id="payout-type" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{["WINNER_PAYOUT", "MEMBER_AUCTION_BENEFIT", ...(admin ? ["PLATFORM_FEE_SETTLEMENT"] : [])].map(t => <option key={t}>{t}</option>)}</Select></FormField><FormField label="Status" htmlFor="payout-status"><Select id="payout-status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</Select></FormField>
    {admin && <>{([["Group ID", group, setGroup], ["Cycle ID", cycle, setCycle], ["Created from (UTC)", from, setFrom], ["Created before (UTC)", to, setTo]] as const).map(([label, value, set]) => <FormField key={label} label={label} htmlFor={label}><Input id={label} type={label.includes("UTC") ? "date" : "text"} value={value} onChange={e => { set(e.target.value); setPage(1); }} /></FormField>)}</>}</div>
    {admin && <Button onClick={prepare} disabled={!cycle} loading={busy}>Prepare selected cycle settlement</Button>}</CardBody></Card>}
    {(error || data.error) && <ErrorState message={error || data.error || ""} onRetry={data.reload} />}
    <Card><CardHeader title={type === "MEMBER_AUCTION_BENEFIT" ? "Auction benefits" : type === "WINNER_PAYOUT" ? "Winner payouts" : "Payout history"} /><DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={p => p.id} empty={admin ? { title: status ? "No payouts in this state" : "No payouts require your attention", description: status ? "Clear the filter to see every payout." : "You're all caught up. New payout obligations appear after a funded cycle selection is prepared." } : { title: "No payouts yet", description: organizer ? "Payout rights and auction benefits for this group appear here after a cycle selection is completed." : "Your eligible payouts and auction benefits will appear here after a cycle selection is completed." }} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payouts" /></CardBody></Card>
    {!admin && !organizer && <div id="payout-account"><PayoutAccountForm /></div>}
  </div>;
}
export function PayoutDetailsPage({ admin = false }: { admin?: boolean }) { return <ProtectedPage roles={admin ? ["ADMIN", "SUPER_ADMIN"] : undefined}><Details admin={admin} /></ProtectedPage>; }
function Details({ admin }: { admin: boolean }) {
  const { id } = useParams<{ id: string }>(); const data = useAsyncData(() => payoutService.details(id, admin), [id, admin]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const keys = useRef<Record<string, string>>({});
  async function act(action: string) { setBusy(true); setError(""); const scope = `${action}:${data.data?.attempts.length ?? 0}`; keys.current[scope] ??= crypto.randomUUID();
    try { await payoutService.action(id, action, keys.current[scope]); data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Payout operation failed."); } finally { setBusy(false); } }
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />; if (!data.data) return <PageSkeleton />;
  const { payout: p, attempts, timeline, events } = data.data;
  const checklist = payoutChecklist(p);
  const execBlocked = admin && p.payoutType !== "PLATFORM_FEE_SETTLEMENT" && ["PENDING_BENEFICIARY", "APPROVAL_REQUIRED"].includes(p.status) ? (p.maskedAccountNumber ? "The destination must be approved before execution." : "Recipient has not added a payout bank account.") : null;
  return <div className="stack stack--lg"><Breadcrumbs items={[{ label: admin ? "Payout operations" : "My payouts", href: "/payouts" }, { label: `${p.groupName} · Cycle ${p.cycleNumber}` }, { label: humanize(p.payoutType) }]} />
    <PageHeader title={`${humanize(p.payoutType)} · ${formatMoney(p.amount)}`} description={`${p.memberName} · ${p.groupName} · Cycle ${p.cycleNumber}`} actions={<Badge tone="info">Fake Test Mode</Badge>} />
    <WorkflowStatusCard summary={payoutSummary(p, admin ? "admin" : "member")} viewer={admin ? "admin" : "member"} title="Payout progress" stepperLabel="Payout steps" />
    {admin && <Card><CardHeader title="Readiness checklist" /><CardBody><ul className="wf-checklist">{checklist.map(c => <li key={c.label} className={c.done ? "wf-checklist__item wf-checklist__item--done" : "wf-checklist__item"}><span aria-hidden>{c.done ? "✓" : "○"}</span><span><strong>{c.label}</strong>{c.hint && <span className="text-sm text-muted"> · {c.hint}</span>}</span><span className="sr-only">{c.done ? "done" : "pending"}</span></li>)}</ul></CardBody></Card>}
    <div className="row"><LinkButton href="/payouts" variant="secondary">Payout history</LinkButton><Status p={p} />
    {admin && p.payoutType !== "PLATFORM_FEE_SETTLEMENT" && <>{["PENDING_BENEFICIARY", "APPROVAL_REQUIRED"].includes(p.status) && <Button loading={busy} onClick={() => act("approve")}>Approve destination</Button>}{p.status === "APPROVED" && <Button loading={busy} onClick={() => act("execute")}>Execute test payout</Button>}{p.status === "PENDING_BENEFICIARY" && <UnavailableAction id="approve-payout" label="Approve destination" reason="Recipient has not added a payout bank account." />}{execBlocked && <UnavailableAction id="execute-payout" label="Execute test payout" reason={execBlocked} />}{p.status === "FAILED" && <Button loading={busy} onClick={() => act("retry")}>Retry failed payout</Button>}{["PROCESSING", "PROVIDER_PENDING"].includes(p.status) && <Button loading={busy} onClick={() => act("reconcile")}>Reconcile provider status</Button>}</>}</div>
    {error && <Callout variant="danger" title="The payout operation didn't complete">{error} Nothing was changed; check the payout status and try again.</Callout>}{p.status === "RECONCILIATION_REQUIRED" && <Callout variant="warning" title="Reconciliation required">Provider data did not match Dhanvi&apos;s record. Settlement and retries stay blocked until the mismatch is reviewed.</Callout>}
    <Card><CardBody><dl className="grid-2">{[["Recipient", p.memberName], ["Type", humanize(p.payoutType)], ["Payout right", formatMoney(p.amount)], ["Destination", p.maskedAccountNumber ?? (p.payoutType === "PLATFORM_FEE_SETTLEMENT" ? "Internal accounting allocation" : "Awaiting approved account")], ["Created", formatDateTime(p.createdAt)], ["Settled", p.settledAt ? formatDateTime(p.settledAt) : "Awaiting settlement"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
    {admin && <div className="stack"><Link className="link" href={`/ledger/journals/${p.allocationJournalId}`}>Funded allocation journal</Link>{p.settlementJournalId && <Link className="link" href={`/ledger/journals/${p.settlementJournalId}`}>Settlement journal</Link>}<details><summary>Immutable source references</summary><p>Selection: {p.selectionResultId}</p>{p.auctionResultId && <p>Auction result: {p.auctionResultId}</p>}</details></div>}</CardBody></Card>
    <Card><CardHeader title="Payout attempts" /><DataTable rows={attempts} rowKey={a => a.id} columns={[{ key: "number", header: "Attempt", render: a => a.attemptNumber }, { key: "destination", header: "Destination", render: a => a.maskedAccountNumber }, { key: "ref", header: "Provider reference", render: a => a.providerPayoutId }, { key: "status", header: "Status", render: a => humanize(a.status) }, { key: "date", header: "Requested", render: a => formatDateTime(a.requestedAt) }]} empty={{ title: "No outgoing attempt" }} /></Card>
    <Card><CardHeader title="Activity" subtitle="How this payout reached its current state" /><CardBody><ol className="stack">{[...timeline].reverse().map(t => <li key={t.id}><span className="text-sm text-muted">{formatDateTime(t.createdAt)}</span><br /><strong>{humanize(t.action)}</strong><p className="text-muted text-sm">{t.message}</p></li>)}</ol></CardBody></Card>
    {admin && <Card><CardHeader title="Provider reconciliation events" /><DataTable rows={events} rowKey={e => e.id} columns={[{ key: "event", header: "Reference", render: e => e.providerEventId }, { key: "status", header: "Provider status", render: e => humanize(e.status) }, { key: "match", header: "Matched", render: e => e.matched ? "Yes" : "Review required" }]} empty={{ title: "No provider observations" }} /></Card>}
  </div>;
}
