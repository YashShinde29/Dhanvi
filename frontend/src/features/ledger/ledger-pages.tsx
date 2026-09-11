"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { useAsyncData } from "@/hooks/use-async-data";
import { ledgerService } from "@/services/ledger.service";
import type { JournalSummary, AccountBalance } from "@/types/ledger";
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime, humanize } from "@/lib/format";

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
const short = (id: string | null) => id ? id.slice(0, 8) : "—";
const BalanceBadge = ({ balanced }: { balanced: boolean }) => <Badge tone={balanced ? "success" : "danger"}>{balanced ? "Balanced" : "Out of balance"}</Badge>;
function LedgerLinks() { return <nav className="row" aria-label="Ledger sections"><LinkButton variant="secondary" size="sm" href="/admin/ledger">Journal entries</LinkButton><LinkButton variant="secondary" size="sm" href="/admin/ledger/trial-balance">Trial balance</LinkButton><LinkButton variant="secondary" size="sm" href="/admin/ledger/accounts">Accounts</LinkButton></nav>; }

function LedgerFilters({ onChange, groupId }: { onChange: (query: string) => void; groupId?: string }) {
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const values = new FormData(e.currentTarget); const query = new URLSearchParams(); values.forEach((v, k) => { if (String(v).trim()) query.set(k, String(v).trim()); }); onChange(query.toString()); }
  return <form onSubmit={submit}><FilterBar>
    <Input type="date" name="from" aria-label="Business date from" /><Input type="date" name="to" aria-label="Business date to" />
    <Input name="journalNumber" placeholder="Journal number" aria-label="Journal number" />
    <Input name="account" placeholder="Account code" aria-label="Account code" />
    {!groupId && <Input name="groupId" placeholder="Group ID" aria-label="Group ID" />}
    <Input name="cycleId" placeholder="Cycle ID" aria-label="Cycle ID" />
    <Select name="eventType" aria-label="Accounting event"><option value="">All events</option><option value="RANDOM_SELECTION_COMPLETED">Random selection</option><option value="ORGANIZER_RESERVED_SELECTION_COMPLETED">Organizer reservation</option><option value="AUCTION_SELECTION_COMPLETED">Auction selection</option><option value="ACCOUNTING_REVERSAL">Reversal</option></Select>
    <Button type="submit" variant="secondary">Apply filters</Button><Button type="reset" variant="ghost" onClick={() => onChange("")}>Clear</Button>
  </FilterBar></form>;
}
const journalColumns: Column<JournalSummary>[] = [
  { key: "number", header: "Journal number", primary: true, render: j => <Link className="link" href={`/admin/ledger/journals/${j.id}`}>{j.journalNumber}</Link> },
  { key: "date", header: "Business date", render: j => formatDate(j.businessDate) },
  { key: "event", header: "Event", render: j => humanize(j.eventType) },
  { key: "description", header: "Description", render: j => j.description },
  { key: "group", header: "Group", render: j => j.groupId ? <Link className="link" title={j.groupId} href={`/admin/ledger/groups/${j.groupId}`}>{short(j.groupId)}</Link> : "Platform" },
  { key: "debit", header: "Debit", align: "right", render: j => <span className="amount">{money(j.debitTotal)}</span> },
  { key: "credit", header: "Credit", align: "right", render: j => <span className="amount">{money(j.creditTotal)}</span> },
  { key: "status", header: "Status", render: j => <Badge tone="success">{humanize(j.status)}</Badge> },
  { key: "posted", header: "Posted at", render: j => formatDateTime(j.postedAt, j.businessTimeZone) },
];
function Totals({ debit, credit, balanced, journals }: { debit: number; credit: number; balanced: boolean; journals?: number }) {
  return <div className={journals === undefined ? "grid-3" : "grid-4"}>{journals !== undefined && <StatCard label="Total journals" value={journals} />}<StatCard label="Total debits" value={money(debit)} /><StatCard label="Total credits" value={money(credit)} /><StatCard label="Balance check" value={<BalanceBadge balanced={balanced} />} /></div>;
}
export function AdminLedgerPage({ group = false }: { group?: boolean }) { return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><JournalList group={group} /></ProtectedPage>; }
function JournalList({ group }: { group: boolean }) {
  const params = useParams<{ groupId: string }>(); const groupId = group ? params.groupId : undefined;
  const [filters, setFilters] = useState(""); const [page, setPage] = useState(1);
  const data = useAsyncData(async () => { const [journals, totals] = await Promise.all([ledgerService.journals(`${filters}&page=${page}&pageSize=20`, groupId), ledgerService.trialBalance(filters, groupId)]); return { journals, totals }; }, [filters, page, groupId]);
  return <div className="stack stack--lg"><PageHeader eyebrow="Accounting" title={group ? "Group ledger" : "Financial ledger"} description="Posted accounting entries. Calculated payout rights and operational contributions are not proof of payment." />
    <LedgerLinks />{groupId && <Link className="link" href={`/admin/groups/${groupId}`}>Back to group {short(groupId)}</Link>}
    <LedgerFilters groupId={groupId} onChange={q => { setFilters(q); setPage(1); }} />
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <>
      {data.data && <Totals debit={data.data.totals.totalDebits} credit={data.data.totals.totalCredits} balanced={data.data.totals.balanced} journals={data.data.totals.totalJournals} />}
      <Card><CardHeader title="Journal entries" subtitle="Immutable history · INR" /><DataTable columns={journalColumns} rows={data.data?.journals.items} rowKey={j => j.id} loading={data.loading} empty={{ title: "No posted journals", description: "Actual payment settlement is not enabled. Manual contributions and unfunded selections do not create financial ledger entries." }} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.journals.totalCount ?? 0} onPageChange={setPage} itemLabel="journals" /></CardBody></Card>
    </>}
  </div>;
}
export function JournalDetailsPage() { return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><JournalDetails /></ProtectedPage>; }
function JournalDetails() {
  const { id } = useParams<{ id: string }>(); const data = useAsyncData(() => ledgerService.journal(id), [id]);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />; if (!data.data) return <PageSkeleton />;
  const d = data.data, j = d.journal;
  return <div className="stack stack--lg"><Breadcrumbs items={[{ label: "Ledger", href: "/admin/ledger" }, { label: j.journalNumber }]} /><PageHeader title={j.journalNumber} description={j.description} />
    <Card><CardBody><dl className="grid-2">{[
      ["Event", humanize(j.eventType)], ["Source", j.sourceModule], ["Event ID", d.eventId], ["Business date", formatDate(j.businessDate)],
      ["Posted at", formatDateTime(j.postedAt, j.businessTimeZone)], ["Business timezone", j.businessTimeZone], ["Policy version", d.policyVersion], ["Fee recognition", humanize(d.feePolicy)],
      ["Posted by", d.postedBy], ["Correlation ID", d.correlationId ?? "—"],
    ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl>
    {d.reversesJournalEntryId && <p>Reverses <Link className="link" href={`/admin/ledger/journals/${d.reversesJournalEntryId}`}>original journal</Link>: {d.reversalReason}</p>}
    {d.reversedByJournalEntryId && <p>Corrected by <Link className="link" href={`/admin/ledger/journals/${d.reversedByJournalEntryId}`}>reversal journal</Link>.</p>}
    </CardBody></Card>
    <Card><CardHeader title="Journal lines" /><DataTable rows={d.lines} rowKey={l => l.id} columns={[
      { key: "account", header: "Account", primary: true, render: l => `${l.accountCode} · ${l.accountName}` },
      { key: "debit", header: "Debit", align: "right", render: l => <span className="amount">{money(l.debitAmount)}</span> },
      { key: "credit", header: "Credit", align: "right", render: l => <span className="amount">{money(l.creditAmount)}</span> },
      { key: "group", header: "Group", render: l => <span title={l.groupId ?? ""}>{short(l.groupId)}</span> },
      { key: "cycle", header: "Cycle", render: l => <span title={l.cycleId ?? ""}>{short(l.cycleId)}</span> },
      { key: "member", header: "Membership", render: l => <span title={l.membershipId ?? ""}>{short(l.membershipId)}</span> },
      { key: "reference", header: "Reference", render: l => <span title={l.referenceId}>{l.referenceType} · {short(l.referenceId)}</span> },
    ]} /><CardBody><Totals debit={j.debitTotal} credit={j.creditTotal} balanced={j.debitTotal === j.creditTotal} /></CardBody></Card>
    <Callout variant="info">Liabilities and calculated entitlements do not indicate that payouts, benefits or fees have been settled.</Callout>
  </div>;
}
const balanceColumns: Column<AccountBalance>[] = [
  { key: "code", header: "Code", primary: true, render: a => a.code }, { key: "name", header: "Account", render: a => a.name },
  { key: "type", header: "Type", render: a => humanize(a.accountType) },
  { key: "debit", header: "Debit", align: "right", render: a => money(a.debitTotal) }, { key: "credit", header: "Credit", align: "right", render: a => money(a.creditTotal) },
  { key: "balance", header: "Normal balance", align: "right", render: a => `${money(a.balance)} ${a.normalBalance === "DEBIT" ? "Dr" : "Cr"}` },
];
export function TrialBalancePage() { return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><TrialBalanceContent /></ProtectedPage>; }
function TrialBalanceContent() {
  const [filters, setFilters] = useState(""); const data = useAsyncData(() => ledgerService.trialBalance(filters), [filters]);
  return <div className="stack stack--lg"><PageHeader title="Trial balance" description="Totals from posted journal lines. Positive balances follow each account’s normal debit or credit side." /><LedgerLinks /><LedgerFilters onChange={setFilters} />
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <Card><DataTable columns={balanceColumns} rows={data.data?.accounts} rowKey={a => a.code} loading={data.loading} />{data.data && <CardBody><Totals debit={data.data.totalDebits} credit={data.data.totalCredits} balanced={data.data.balanced} /></CardBody>}</Card>}
  </div>;
}
export function LedgerAccountsPage() { return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><AccountsContent /></ProtectedPage>; }
function AccountsContent() {
  const data = useAsyncData(ledgerService.accounts, []);
  return <div className="stack stack--lg"><PageHeader title="Chart of accounts" description="Read-only system accounts. Stable codes identify posting rules; balances come from journal lines." /><LedgerLinks />
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <Card><DataTable rows={data.data ?? undefined} rowKey={a => a.id} loading={data.loading} columns={[
      { key: "code", header: "Code", primary: true, render: a => a.code }, { key: "name", header: "Name", render: a => a.name }, { key: "type", header: "Type", render: a => humanize(a.accountType) },
      { key: "normal", header: "Normal balance", render: a => humanize(a.normalBalance) }, { key: "status", header: "Status", render: a => <Badge tone={a.isActive ? "success" : "neutral"}>{a.isActive ? "Active" : "Inactive"}</Badge> },
    ]} /></Card>}
  </div>;
}
export function MemberLedgerPage() { return <ProtectedPage><MemberContent /></ProtectedPage>; }
function MemberContent() {
  const { user } = useAuth(); const [page, setPage] = useState(1); const data = useAsyncData(() => ledgerService.mine(`page=${page}&pageSize=20`), [page, user?.id]);
  return <div className="stack stack--lg"><PageHeader title="Financial history" description="Your posted financial entries. Entitlements shown here have not necessarily been paid." />
    {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <Card><DataTable rows={data.data?.items} rowKey={l => l.id} loading={data.loading} empty={{ title: "No financial ledger entries are available yet.", description: "Actual payment settlement is not enabled." }} columns={[
      { key: "date", header: "Date", primary: true, render: l => formatDate(l.businessDate) }, { key: "description", header: "Description", render: l => <>{l.accountName}<div className="text-sm text-muted">{l.description}</div></> },
      { key: "increase", header: "Increase", align: "right", render: l => money(l.increase) }, { key: "decrease", header: "Decrease", align: "right", render: l => money(l.decrease) },
      { key: "reference", header: "Reference", render: l => <>{l.journalNumber}<div><Link className="link" href={`/groups/${l.groupId}`}>View group</Link></div></> },
    ]} /><CardBody><Pagination page={page} pageSize={20} totalCount={data.data?.totalCount ?? 0} onPageChange={setPage} /></CardBody></Card>}
  </div>;
}
