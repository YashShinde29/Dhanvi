"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAsyncData } from "@/hooks/use-async-data";
import { payoutService } from "@/services/payout.service";
import type { Payout } from "@/types/payout";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { FormField, Input, Select } from "@/components/ui/form";
import { StatCard } from "@/components/ui/stat-card";
import { Callout, ErrorState } from "@/components/ui/callout";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatMoney, humanize } from "@/lib/format";
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
  async function prepare() { setBusy(true); setError(""); try { await payoutService.prepare(cycle); data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare settlement."); } finally { setBusy(false); } }
  const columns: Column<Payout>[] = [
    { key: "id", header: "Payout", primary: true, render: p => organizer ? p.id.slice(0, 8) : <Link className="link" href={`${admin ? "/admin" : ""}/payouts/${p.id}`}>{p.id.slice(0, 8)}</Link> },
    { key: "recipient", header: "Recipient", render: p => p.memberName },
    { key: "group", header: "Group / Cycle", render: p => <>{p.groupName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "type", header: "Type", render: p => humanize(p.payoutType) },
    { key: "amount", header: "Amount", align: "right", render: p => formatMoney(p.amount) },
    { key: "status", header: "Status", render: p => <Status p={p} /> },
    { key: "provider", header: "Provider", render: p => p.payoutType === "PLATFORM_FEE_SETTLEMENT" ? "Internal allocation" : "Fake test provider" },
    { key: "created", header: "Created", render: p => formatDateTime(p.createdAt) },
  ];
  return <div className="stack stack--lg"><PageHeader title={admin ? "Payout operations" : organizer ? "Group payouts" : "My payouts"} description="Winner payout rights and auction benefits, with separate transfer status." actions={<Badge tone="info">Fake Test Mode</Badge>} />
    <Callout variant="info">Selection establishes a payout right. A successful test settlement appears only after provider reconciliation. No real money is transferred.</Callout>
    {admin && <div className="grid-3">{["PENDING_BENEFICIARY", "APPROVED", "PROCESSING", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED"].map(s => <StatCard key={s} label={s === "PENDING_BENEFICIARY" ? "Awaiting account / approval" : s === "APPROVED" ? "Ready to execute" : humanize(s)} value={(data.data?.summary?.[s] ?? 0) + (s === "PROCESSING" ? data.data?.summary?.PROVIDER_PENDING ?? 0 : 0)} />)}</div>}
    {!organizer && <Card><CardBody className="stack"><div className="grid-2"><FormField label="Payout type" htmlFor="payout-type"><Select id="payout-type" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{["WINNER_PAYOUT", "MEMBER_AUCTION_BENEFIT", ...(admin ? ["PLATFORM_FEE_SETTLEMENT"] : [])].map(t => <option key={t}>{t}</option>)}</Select></FormField><FormField label="Status" htmlFor="payout-status"><Select id="payout-status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</Select></FormField>
    {admin && <>{([["Group ID", group, setGroup], ["Cycle ID", cycle, setCycle], ["Created from (UTC)", from, setFrom], ["Created before (UTC)", to, setTo]] as const).map(([label, value, set]) => <FormField key={label} label={label} htmlFor={label}><Input id={label} type={label.includes("UTC") ? "date" : "text"} value={value} onChange={e => { set(e.target.value); setPage(1); }} /></FormField>)}</>}</div>
    {admin && <Button onClick={prepare} disabled={!cycle} loading={busy}>Prepare selected cycle settlement</Button>}</CardBody></Card>}
    {(error || data.error) && <ErrorState message={error || data.error || ""} onRetry={data.reload} />}
    <Card><CardHeader title={type === "MEMBER_AUCTION_BENEFIT" ? "Auction benefits" : type === "WINNER_PAYOUT" ? "Winner payouts" : "Payout history"} /><DataTable columns={columns} rows={data.data?.items} loading={data.loading} rowKey={p => p.id} empty={{ title: "No payout obligations", description: "Payouts appear after a funded selection is prepared for settlement." }} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} itemLabel="payouts" /></CardBody></Card>
    {!admin && !organizer && <PayoutAccountForm />}
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
  return <div className="stack stack--lg"><PageHeader title="Payout details" description={`${p.groupName} · Cycle ${p.cycleNumber}`} actions={<Badge tone="info">Fake Test Mode</Badge>} />
    <div className="row"><LinkButton href={admin ? "/admin/payouts" : "/payouts"} variant="secondary">Payout history</LinkButton><Status p={p} />
    {admin && p.payoutType !== "PLATFORM_FEE_SETTLEMENT" && <>{["PENDING_BENEFICIARY", "APPROVAL_REQUIRED"].includes(p.status) && <Button loading={busy} onClick={() => act("approve")}>Approve destination</Button>}{p.status === "APPROVED" && <Button loading={busy} onClick={() => act("execute")}>Execute test payout</Button>}{p.status === "FAILED" && <Button loading={busy} onClick={() => act("retry")}>Retry failed payout</Button>}{["PROCESSING", "PROVIDER_PENDING"].includes(p.status) && <Button loading={busy} onClick={() => act("reconcile")}>Reconcile provider status</Button>}</>}</div>
    {error && <Callout variant="danger">{error}</Callout>}{p.status === "RECONCILIATION_REQUIRED" && <Callout variant="warning">A provider mismatch requires review. Settlement and retries remain blocked.</Callout>}
    <Card><CardBody><dl className="grid-2">{[["Recipient", p.memberName], ["Type", humanize(p.payoutType)], ["Payout right", formatMoney(p.amount)], ["Destination", p.maskedAccountNumber ?? (p.payoutType === "PLATFORM_FEE_SETTLEMENT" ? "Internal accounting allocation" : "Awaiting approved account")], ["Created", formatDateTime(p.createdAt)], ["Settled", p.settledAt ? formatDateTime(p.settledAt) : "Awaiting settlement"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd>{value}</dd></div>)}</dl>
    {admin && <div className="stack"><Link className="link" href={`/admin/ledger/journals/${p.allocationJournalId}`}>Funded allocation journal</Link>{p.settlementJournalId && <Link className="link" href={`/admin/ledger/journals/${p.settlementJournalId}`}>Settlement journal</Link>}<details><summary>Immutable source references</summary><p>Selection: {p.selectionResultId}</p>{p.auctionResultId && <p>Auction result: {p.auctionResultId}</p>}</details></div>}</CardBody></Card>
    <Card><CardHeader title="Payout attempts" /><DataTable rows={attempts} rowKey={a => a.id} columns={[{ key: "number", header: "Attempt", render: a => a.attemptNumber }, { key: "destination", header: "Destination", render: a => a.maskedAccountNumber }, { key: "ref", header: "Provider reference", render: a => a.providerPayoutId }, { key: "status", header: "Status", render: a => humanize(a.status) }, { key: "date", header: "Requested", render: a => formatDateTime(a.requestedAt) }]} empty={{ title: "No outgoing attempt" }} /></Card>
    <Card><CardHeader title="Timeline" /><CardBody><ol className="stack">{timeline.map(t => <li key={t.id}><strong>{humanize(t.action)}</strong> · {formatDateTime(t.createdAt)}<p>{t.message}</p></li>)}</ol></CardBody></Card>
    {admin && <Card><CardHeader title="Provider reconciliation events" /><DataTable rows={events} rowKey={e => e.id} columns={[{ key: "event", header: "Reference", render: e => e.providerEventId }, { key: "status", header: "Provider status", render: e => humanize(e.status) }, { key: "match", header: "Matched", render: e => e.matched ? "Yes" : "Review required" }]} empty={{ title: "No provider observations" }} /></Card>}
  </div>;
}
