"use client";
import Link from "next/link";
import { adminService } from "@dhanvi/api-client";
import { adminAttention, adminWaiting, NextActionList } from "../workflow";
import { useAsyncData, formatDateTime } from "@dhanvi/utils";
import { PageHeader, SectionHeader, StatCard, ErrorState, Icons, SkeletonStats, SkeletonText } from "@dhanvi/ui";

/**
 * Admin Control Center home: "What needs my attention?" first, platform health second, module navigation third.
 * One aggregated read model call; no per-group requests. Detailed data lives in the module pages.
 */
export function AdminDashboard() {
  const { data, error, loading, reload } = useAsyncData(() => adminService.overview(), []);
  if (error) return <div className="stack stack--lg"><PageHeader eyebrow="Control center" title="Dashboard" /><ErrorState message={error} onRetry={reload} /></div>;
  const attention = data ? adminAttention(data) : [];
  const waiting = data ? adminWaiting(data) : [];
  const o = data;
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Control center" title="Requires attention" description={o ? `Platform state as of ${formatDateTime(o.generatedAt)}` : undefined} />
      <section className="section" aria-labelledby="admin-attention">
        <SectionHeader title={<span id="admin-attention">Requires your attention</span>} description={attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"} · most urgent first` : undefined} />
        {loading && !data ? <SkeletonText /> : <NextActionList actions={attention} viewer="admin" limit={12} emptyTitle="No groups need attention" emptyDescription="All active groups are progressing normally. Reconciliation issues, payout approvals, selections and activations appear here as they arise." />}
      </section>
      {waiting.length > 0 && (
        <section className="section" aria-labelledby="admin-waiting">
          <SectionHeader title={<span id="admin-waiting">Moving without you</span>} description="Waiting on members, organizers or providers — no action from you." />
          <NextActionList actions={waiting} viewer="admin" limit={6} />
        </section>
      )}
      <section className="section" aria-labelledby="admin-health">
        <SectionHeader title={<span id="admin-health">Platform health</span>} />
        {loading && !o ? <SkeletonStats count={6} /> : o && (
          <div className="grid-6">
            <StatCard label="Active groups" value={o.groups.active} icon={<Icons.Layers size={16} />} compact hint={`${o.groups.cyclesCollecting} collecting · ${o.groups.cyclesPayoutPending} paying out`} />
            <StatCard label="Recruiting" value={o.groups.recruiting} icon={<Icons.Users size={16} />} compact hint={`${o.groups.fullySubscribed} fully subscribed`} />
            <StatCard label="Ready to start" value={o.groups.readyToStart} icon={<Icons.Play size={16} />} compact accent={o.groups.platformReadyToActivate.count > 0} hint={o.groups.platformReadyToActivate.count ? `${o.groups.platformReadyToActivate.count} platform` : undefined} />
            <StatCard label="Groups with issues" value={o.groups.suspended + o.groups.auctionsClosedNoBids.count + o.payouts.counts.failed + o.payouts.counts.reconciliationRequired + o.payments.counts.reconciliationRequired} icon={<Icons.Alert size={16} />} compact accent={o.groups.suspended + o.groups.auctionsClosedNoBids.count + o.payouts.counts.failed + o.payouts.counts.reconciliationRequired + o.payments.counts.reconciliationRequired > 0} hint={`${o.groups.suspended} suspended`} />
            <StatCard label="Active members" value={o.groups.activeMembers} icon={<Icons.User size={16} />} compact />
            <StatCard label="Approved organizers" value={o.organizers.approved} icon={<Icons.BadgeCheck size={16} />} compact hint={o.organizers.suspended ? `${o.organizers.suspended} suspended` : undefined} />
            <StatCard label="Payments captured" value={o.payments.counts.captured} icon={<Icons.Wallet size={16} />} compact hint={`${o.payments.counts.pending} pending · ${o.payments.counts.failed} failed`} />
            <StatCard label="Payment reconciliation" value={o.payments.counts.reconciliationRequired} icon={<Icons.Scale size={16} />} compact accent={o.payments.counts.reconciliationRequired > 0} />
            <StatCard label="Payouts processing" value={o.payouts.counts.processing} icon={<Icons.Clock size={16} />} compact hint={`${o.payouts.counts.succeeded} succeeded`} />
            <StatCard label="Payouts awaiting approval" value={o.payouts.counts.approvalRequired + o.payouts.counts.approved} icon={<Icons.ShieldCheck size={16} />} compact accent={o.payouts.counts.approvalRequired + o.payouts.counts.approved > 0} hint={`${o.payouts.counts.approvalRequired} to approve · ${o.payouts.counts.approved} to execute`} />
            <StatCard label="Failed payouts" value={o.payouts.counts.failed} icon={<Icons.Alert size={16} />} compact accent={o.payouts.counts.failed > 0} />
            <StatCard label="Payout reconciliation" value={o.payouts.counts.reconciliationRequired} icon={<Icons.Scale size={16} />} compact accent={o.payouts.counts.reconciliationRequired > 0} />
          </div>
        )}
      </section>
      <nav className="grid-3" aria-label="Modules">
        {[
          { href: "/groups", label: "Groups", desc: "Lifecycle, cycles, collection, selection, payouts and health per group.", icon: <Icons.Layers size={18} /> },
          { href: "/organizers", label: "Organizer applications", desc: "Review who may create groups.", icon: <Icons.Inbox size={18} /> },
          { href: "/payments", label: "Payments", desc: "Incoming Razorpay captures and exceptions.", icon: <Icons.Wallet size={18} /> },
          { href: "/payouts", label: "Payouts", desc: "Approve, execute, retry and reconcile transfers.", icon: <Icons.Send size={18} /> },
          { href: "/reconciliation", label: "Reconciliation", desc: "Every payment and payout the provider disagrees with.", icon: <Icons.Scale size={18} /> },
          { href: "/ledger", label: "Ledger", desc: "Journals, trial balance and accounts.", icon: <Icons.Activity size={18} /> },
        ].map((m) => <Link key={m.href} href={m.href} className="attention"><span className="attention__count" style={{ minWidth: 0, color: "var(--color-text-muted)" }}>{m.icon}</span><span className="attention__text"><span className="attention__title">{m.label}</span><span className="attention__desc">{m.desc}</span></span><Icons.ChevronRight size={16} style={{ color: "var(--color-text-muted)" }} /></Link>)}
      </nav>
    </div>
  );
}
