"use client";
import Link from "next/link";
import { useState } from "react";
import { ledgerService } from "@dhanvi/api-client";
import type { AdminActivityEntry, AdminCycleSnapshot, AdminGroupIssue, AdminGroupRow, AdminOutstandingContribution, AdminPayoutSnapshot, AdminPaymentSnapshot, JournalSummary } from "@dhanvi/types";
import { useAsyncData, formatDate, formatDateTime, formatMoney, humanize, statusLabel } from "@dhanvi/utils";
import { Badge, Button, Card, CardBody, CardHeader, DataTable, type Column, ErrorState, Icons, LinkButton, SkeletonText, StatusBadge } from "@dhanvi/ui";
import { ageSince, responsibleLabel } from "../workflow";

/** "Issues & blockers" — rendered only when something needs attention. */
export function IssuesPanel({ issues }: { issues: AdminGroupIssue[] }) {
  if (issues.length === 0) return null;
  const href = (i: AdminGroupIssue) => i.referenceType === "PAYMENT" ? `/payments/${i.referenceId}` : i.referenceType === "PAYOUT" ? `/payouts/${i.referenceId}` : null;
  const tone = (i: AdminGroupIssue) => i.responsibleRole === "USER" || i.responsibleRole === "ORGANIZER" ? "waiting" : i.kind === "OUTSTANDING_CONTRIBUTIONS" ? "waiting" : "blocked";
  return (
    <section className="stack" aria-label="Issues and blockers" style={{ gap: 8 }}>
      <h2 className="h-section" style={{ margin: 0 }}>Issues &amp; blockers</h2>
      {issues.map((i, n) => {
        const link = href(i); const age = ageSince(i.since);
        return (
          <div key={`${i.kind}-${i.referenceId ?? n}`} className={`issue issue--${tone(i)}`}>
            <Icons.Alert size={18} style={{ color: tone(i) === "blocked" ? "var(--color-danger)" : "var(--color-indigo)", flex: "none", marginTop: 2 }} />
            <div className="issue__body">
              <div className="issue__title">{i.title}</div>
              <div className="issue__detail">{i.detail}</div>
              <div className="issue__meta">Waiting on: {responsibleLabel(i.responsibleRole, "admin")}{age ? ` · ${age}` : ""}{i.referenceType === "PAYMENT" && i.referenceId ? ` · PAY-${i.referenceId.slice(0, 8).toUpperCase()}` : ""}</div>
            </div>
            {link && <LinkButton href={link} size="sm" variant="secondary">{i.referenceType === "PAYMENT" ? "Review payment" : "Review payout"}</LinkButton>}
          </div>
        );
      })}
    </section>
  );
}

/** Where the group sits: lifecycle milestones with each cycle's stages, current position highlighted. */
export function GroupTrack({ group: g, cycles }: { group: AdminGroupRow; cycles: AdminCycleSnapshot[] }) {
  const order = ["DRAFT", "PUBLISHED", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE", "COMPLETING", "COMPLETED"];
  const rank = order.indexOf(g.status);
  const halted = g.status === "SUSPENDED" || g.status === "CANCELLED";
  const state = (i: number): "done" | "current" | "upcoming" | "blocked" => (halted ? (i <= 4 ? "done" : "blocked") : i < rank ? "done" : i === rank ? "current" : "upcoming");
  const milestones = [
    { id: "created", title: "Created", meta: formatDate(g.createdAt), state: "done" as const },
    { id: "published", title: "Published", meta: rank >= 2 ? "Rules v1 locked" : undefined, state: state(1) === "current" ? "done" : state(2) === "upcoming" && rank < 2 ? "upcoming" : "done" },
    { id: "recruiting", title: "Recruiting", meta: rank === 2 ? `${g.currentMemberCount} of ${g.memberLimit} positions` : rank > 2 ? `${g.memberLimit} positions filled` : undefined, state: state(2) },
    { id: "filled", title: "Filled", meta: rank === 3 ? (g.termsPendingCount ? `${g.termsPendingCount} to accept rules` : "All rules accepted") : undefined, state: state(3) },
    { id: "ready", title: "Ready to start", meta: rank === 4 ? `Starts ${formatDate(g.startDate)}` : undefined, state: state(4) },
    { id: "activated", title: "Activated", meta: g.activatedAt ? formatDateTime(g.activatedAt) : undefined, state: g.activatedAt ? "done" : halted ? "blocked" : "upcoming" },
  ] as { id: string; title: string; meta?: string; state: "done" | "current" | "upcoming" | "blocked" }[];
  const sub = (c: AdminCycleSnapshot) => {
    const r: Record<string, number> = { UPCOMING: -1, COLLECTING_CONTRIBUTIONS: 0, CONTRIBUTIONS_COMPLETE: 1, READY_FOR_SELECTION: 1, SELECTION_COMPLETED: 2, PAYOUT_PENDING: 2, PAYOUT_COMPLETED: 3, COMPLETED: 4, SUSPENDED: -2 };
    const cur = r[c.status] ?? -1;
    const st = (i: number) => (cur > i ? "done" : cur === i ? "current" : "upcoming");
    return [
      { label: `Contributions · ${c.settledMemberCount}/${c.expectedMemberCount}`, state: st(0) }, { label: c.selectionMethod === "AUCTION" ? `Auction${c.auctionStatus ? ` · ${statusLabel("auction", c.auctionStatus)}` : ""}` : `Selection${c.winnerName ? ` · #${c.winnerSlotNumber} ${c.winnerName}` : ""}`, state: st(1) },
      { label: "Payout", state: st(2) }, { label: "Complete", state: cur >= 4 ? "done" : "upcoming" },
    ] as { label: string; state: "done" | "current" | "upcoming" }[];
  };
  const upcoming = cycles.filter((c) => c.status === "UPCOMING");
  return (
    <ol className="track" aria-label="Group tracking">
      {milestones.map((m) => <li key={m.id} className={`track__item track__item--${m.state}`}><span className="track__marker">{m.state === "done" ? <Icons.Check size={12} /> : m.state === "blocked" ? <Icons.X size={12} /> : ""}</span><div><div className="track__title">{m.title}</div>{m.meta && <div className="track__meta">{m.meta}</div>}</div></li>)}
      {cycles.filter((c) => c.status !== "UPCOMING").map((c) => {
        const current = c.cycleNumber === g.currentCycleNumber && g.status === "ACTIVE";
        const done = c.status === "COMPLETED" || c.status === "PAYOUT_COMPLETED";
        return (
          <li key={c.id} className={`track__item track__item--${done ? "done" : current ? "current" : c.status === "SUSPENDED" ? "blocked" : "upcoming"}`}>
            <span className="track__marker">{done ? <Icons.Check size={12} /> : c.cycleNumber}</span>
            <div><div className="track__title">Cycle {c.cycleNumber} of {g.durationMonths}{done ? ` · complete ${formatDate(c.completedAt)}` : ` · ${statusLabel("cycle", c.status)}`}</div>
              {current && <div className="track__sub">{sub(c).map((s) => <span key={s.label} className={`track__sub-item track__sub-item--${s.state}`}>{s.state === "done" ? <Icons.Check size={12} /> : s.state === "current" ? <Icons.ChevronRight size={12} /> : <Icons.Circle size={10} />}{s.label}</span>)}</div>}
            </div>
          </li>
        );
      })}
      {upcoming.length > 0 && <li className="track__item track__item--upcoming"><span className="track__marker" /><div><div className="track__title">{upcoming.length === 1 ? `Cycle ${upcoming[0]!.cycleNumber}` : `Cycles ${upcoming[0]!.cycleNumber}–${upcoming[upcoming.length - 1]!.cycleNumber}`} upcoming</div></div></li>}
      <li className={`track__item track__item--${g.status === "COMPLETED" ? "done" : "upcoming"}`}><span className="track__marker">{g.status === "COMPLETED" ? <Icons.Check size={12} /> : ""}</span><div><div className="track__title">Group completed</div></div></li>
    </ol>
  );
}

const NOISY = new Set(["MONTHLY_CYCLES_CREATED", "CONTRIBUTIONS_CREATED", "GROUP_RULE_VERSION_CREATED", "ORGANIZER_ADDED_AS_MEMBER", "CYCLE_CONTRIBUTIONS_COMPLETED", "PAYOUT_LEDGER_POSTED"]);
const friendly = (a: AdminActivityEntry) => a.message ?? humanize(a.action);

export function ActivityTimeline({ activity, limit }: { activity: AdminActivityEntry[]; limit?: number }) {
  const [technical, setTechnical] = useState(false);
  const rows = activity.filter((a) => technical || !NOISY.has(a.action)).slice(0, limit ?? activity.length);
  if (activity.length === 0) return <p className="text-sm text-muted">No activity recorded yet.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="activity">
        {rows.map((a) => (
          <div key={`${a.source}-${a.id}`} className="activity__item">
            <span className="activity__icon">{a.source === "PAYOUT" ? <Icons.Wallet size={14} /> : <Icons.Activity size={14} />}</span>
            <div style={{ minWidth: 0 }}><div className="activity__title">{friendly(a)}</div><div className="activity__desc">{a.actorName ? `by ${a.actorName}` : a.source === "PAYOUT" ? "Payout operations" : "System"}{a.message && a.message !== friendly(a) ? ` · ${humanize(a.action)}` : ""}</div></div>
            <span className="activity__time">{formatDateTime(a.at)}</span>
          </div>
        ))}
      </div>
      {!limit && activity.some((a) => NOISY.has(a.action)) && <Button variant="ghost" size="sm" onClick={() => setTechnical((v) => !v)}>{technical ? "Hide technical events" : "Show technical events"}</Button>}
    </div>
  );
}

export function OutstandingList({ items, mode }: { items: AdminOutstandingContribution[]; mode: "MANUAL_TRACKING" | "RAZORPAY" }) {
  if (items.length === 0) return <p className="text-sm text-success">All contributions are {mode === "RAZORPAY" ? "settled" : "recorded"}.</p>;
  return (
    <ul className="ops__list">
      {items.map((o) => <li key={o.contributionId}><Badge tone={o.status === "OVERDUE" ? "danger" : "warning"}>{o.status === "OVERDUE" ? "Overdue" : "Outstanding"}</Badge><span>{o.slotNumber ? `#${o.slotNumber} ` : ""}<strong>{o.memberName}</strong> · {formatMoney(mode === "RAZORPAY" ? o.settledAmount : o.manualRecordedAmount)} of {formatMoney(o.expectedAmount)} · due {formatDate(o.dueDate)}</span></li>)}
    </ul>
  );
}

const payoutTone = (s: string) => s === "SUCCEEDED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(s) ? "danger" : ["APPROVAL_REQUIRED", "APPROVED"].includes(s) ? "warning" : "neutral";
export function GroupPayoutsTable({ payouts }: { payouts: AdminPayoutSnapshot[] }) {
  const columns: Column<AdminPayoutSnapshot>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (p) => <span className="text-strong">Cycle {p.cycleNumber}</span> },
    { key: "recipient", header: "Recipient", render: (p) => p.memberName },
    { key: "type", header: "Type", render: (p) => humanize(p.payoutType) },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "stage", header: "Stage", render: (p) => <span className="cell-tight"><Badge tone={payoutTone(p.status)}>{humanize(p.status)}</Badge>{!p.hasBeneficiary && p.status === "PENDING_BENEFICIARY" && <span className="cell__sub">Waiting on member bank account</span>}</span> },
    { key: "when", header: "Updated", render: (p) => formatDateTime(p.settledAt ?? p.approvedAt ?? p.createdAt) },
    { key: "actions", header: "", actions: true, render: (p) => <LinkButton href={`/payouts/${p.id}`} size="sm" variant={["APPROVAL_REQUIRED", "APPROVED", "FAILED", "RECONCILIATION_REQUIRED"].includes(p.status) ? "primary" : "secondary"}>{p.status === "APPROVAL_REQUIRED" ? "Review" : p.status === "APPROVED" ? "Execute" : p.status === "FAILED" ? "Retry" : "View"}</LinkButton> },
  ];
  return <DataTable columns={columns} rows={payouts} rowKey={(p) => p.id} caption="Group payouts" compact empty={{ title: "No payouts yet", description: "Payout obligations are created when a completed selection is prepared for settlement." }} />;
}

export function GroupPaymentIssuesTable({ issues, counts }: { issues: AdminPaymentSnapshot[]; counts: AdminGroupRow["payments"] }) {
  const columns: Column<AdminPaymentSnapshot>[] = [
    { key: "id", header: "Payment", primary: true, render: (p) => <Link className="link" href={`/payments/${p.id}`}>PAY-{p.id.slice(0, 8).toUpperCase()}</Link> },
    { key: "member", header: "Member", render: (p) => <>{p.memberName}<span className="cell__sub">Cycle {p.cycleNumber}</span></> },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "status", header: "Status", render: (p) => <Badge tone={p.status === "RECONCILIATION_REQUIRED" ? "danger" : "warning"}>{humanize(p.status)}</Badge> },
    { key: "recon", header: "Reconciliation", render: (p) => <>{humanize(p.reconciliationStatus)}{p.reconciliationMessage && <span className="cell__sub">{p.reconciliationMessage}</span>}</> },
    { key: "actions", header: "", actions: true, render: (p) => <LinkButton href={`/payments/${p.id}`} size="sm" variant={p.status === "RECONCILIATION_REQUIRED" ? "primary" : "secondary"}>{p.status === "RECONCILIATION_REQUIRED" ? "Review reconciliation" : "View"}</LinkButton> },
  ];
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}><Badge tone="success" plain>{counts.captured} captured</Badge><Badge tone="info" plain>{counts.pending} pending</Badge><Badge tone={counts.failed ? "warning" : "neutral"} plain>{counts.failed} failed</Badge><Badge tone={counts.reconciliationRequired ? "danger" : "neutral"} plain>{counts.reconciliationRequired} reconciliation</Badge><Link className="link text-sm" href="/payments">All payments</Link></div>
      <DataTable columns={columns} rows={issues} rowKey={(p) => p.id} caption="Payment exceptions for this group" compact empty={{ title: "No payment exceptions", description: "Captured and matched payments need no admin action." }} />
    </div>
  );
}

export function GroupLedgerPanel({ groupId }: { groupId: string }) {
  const data = useAsyncData(async () => { const [journals, totals] = await Promise.all([ledgerService.journals("page=1&pageSize=10", groupId), ledgerService.trialBalance("", groupId)]); return { journals, totals }; }, [groupId]);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <Card><CardBody><SkeletonText lines={3} /></CardBody></Card>;
  const { journals, totals } = data.data;
  const columns: Column<JournalSummary>[] = [
    { key: "number", header: "Journal", primary: true, render: (j) => <Link className="link" href={`/ledger/journals/${j.id}`}>{j.journalNumber}</Link> },
    { key: "date", header: "Business date", render: (j) => formatDate(j.businessDate) },
    { key: "event", header: "Event", render: (j) => <>{humanize(j.eventType)}<span className="cell__sub">{j.description}</span></> },
    { key: "debit", header: "Debit", align: "right", render: (j) => <span className="amount">{formatMoney(j.debitTotal)}</span> },
    { key: "credit", header: "Credit", align: "right", render: (j) => <span className="amount">{formatMoney(j.creditTotal)}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Group ledger" subtitle={`${totals.totalJournals} posted journal${totals.totalJournals === 1 ? "" : "s"} · ${totals.balanced ? "balanced" : "out of balance"}`} actions={<Link className="link text-sm" href={`/ledger/groups/${groupId}`}>Full group ledger</Link>} />
      <DataTable columns={columns} rows={journals.items} rowKey={(j) => j.id} caption="Latest journals" compact empty={{ title: "No posted journals", description: "Manual contributions and unfunded selections do not create financial ledger entries." }} />
    </Card>
  );
}

export const cycleStatusBadge = (c: AdminCycleSnapshot) => <StatusBadge kind="cycle" value={c.status} />;
