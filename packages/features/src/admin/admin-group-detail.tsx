"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ProtectedPage } from "@dhanvi/auth";
import { adminService, auctionService, contributionService, groupService } from "@dhanvi/api-client";
import type { AdminCycleSnapshot, Contribution, Member } from "@dhanvi/types";
import { useAsyncData, formatDate, formatDateTime, formatMoney, statusLabel } from "@dhanvi/utils";
import { CreatorTypeBadge, GroupTypeBadge, StatusBadge, Breadcrumbs, Card, CardBody, CardHeader, Callout, DataTable, type Column, ErrorState, FactStrip, ProgressBar, Tabs, TabPanel, type TabItem, PageSkeleton, LinkButton, Badge } from "@dhanvi/ui";
import { GroupWizard } from "../groups/group-wizard";
import { ImportantRulesCard, RulesSnapshot } from "../groups/group-rules-card";
import { GroupMembersTable } from "../groups/group-members-table";
import { GroupControlPanel } from "../groups/group-control-panel";
import { CycleContributionsTable } from "../contributions/manage-contributions";
import { AuctionSummaryCard } from "../auctions/auction-summary-card";
import { SelectionPanel } from "../selections/selection-panel";
import { cycleFacts, deriveGroupControl, groupHealth } from "../workflow";
import { useTabParam } from "../layout/use-tab";
import { ActivityTimeline, GroupLedgerPanel, GroupPaymentIssuesTable, GroupPayoutsTable, GroupTrack, IssuesPanel, OutstandingList } from "./admin-group-sections";
import { HealthBadge } from "./admin-groups";

const ADMIN_TABS = ["overview", "members", "applications", "cycles", "contributions", "payments", "selection", "payouts", "ledger", "activity", "rules"] as const;

export function AdminGroupDetailPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><AdminGroupDetail /></ProtectedPage>;
}

/**
 * Admin Control Center group page. Answers in order: where is this group, what is blocking it, who must act, what can
 * I do (one primary action in Group Control), and what happened (activity). Tabs hold the detail tables.
 */
function AdminGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [activeTabRaw, setTab] = useTabParam("overview", ADMIN_TABS);
  const summary = useAsyncData(() => adminService.groupSummary(id), [id]);
  const group = useAsyncData(() => groupService.details(id, "admin"), [id]);
  const members = useAsyncData(() => groupService.members(id, "admin"), [id]);
  const s = summary.data; const g = group.data;
  const row = s?.group; const current = row?.currentCycle ?? null;
  const cycles = useAsyncData(() => contributionService.cycles(id, "admin"), [id], !!row?.activatedAt);
  const contributions = useAsyncData(() => contributionService.cycleContributions("admin", id, current!.id), [id, current?.id], !!current);
  const auctionLive = !!current && current.selectionMethod === "AUCTION" && ["READY_FOR_SELECTION", "CONTRIBUTIONS_COMPLETE"].includes(current.status);
  const auction = useAsyncData(() => auctionService.get(id, current!.id), [id, current?.id], auctionLive);
  async function refresh() { await Promise.all([summary.reload(), group.reload(), members.reload(), row?.activatedAt ? cycles.reload() : Promise.resolve(), current ? contributions.reload() : Promise.resolve(), auctionLive ? auction.reload() : Promise.resolve()]); }

  const crumbs = [{ label: "Groups", href: "/groups" }, { label: row?.name ?? g?.name ?? "Group" }];
  if (summary.error || group.error) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={summary.error || group.error} onRetry={() => { void summary.reload(); void group.reload(); }} /></div>;
  if (!s || !g || !row) return <PageSkeleton />;

  const canManage = row.creatorType === "PLATFORM";
  const health = groupHealth(row);
  const memberRows: Member[] = members.data ?? [];
  const termsPending = row.termsPendingCount;
  const currentCycleDto = cycles.data?.find((c) => c.id === current?.id);
  const control = deriveGroupControl({
    group: g, viewer: "admin", canManage, pendingApplications: row.pendingApplications, termsPending,
    currentCycle: current ? cycleFacts(current, auction.data?.status ?? current.auctionStatus) : undefined,
    auction: auction.data ? { canOpen: auction.data.canOpen, canClose: auction.data.canClose } : null,
    payouts: row.payouts, paymentIssues: row.payments.reconciliationRequired,
    hrefs: { group: `/groups/${g.id}`, applications: `/groups/${g.id}?tab=applications`, contributions: () => `/groups/${g.id}?tab=contributions`, auction: (c) => `/groups/${g.id}/cycles/${c}/auction`, payouts: `/groups/${g.id}?tab=payouts`, payments: `/groups/${g.id}?tab=payments`, ledger: `/ledger/groups/${g.id}` },
  });
  const contributionMap = new Map<string, Contribution>((contributions.data ?? []).map((c) => [c.membershipId, c]));
  const payoutByMember = new Map<string, string>();
  for (const p of s.payouts) if (p.membershipId && p.payoutType === "WINNER_PAYOUT" && !payoutByMember.has(p.membershipId)) payoutByMember.set(p.membershipId, p.status);
  const showApplications = row.pendingApplications > 0 || ["RECRUITING", "PUBLISHED"].includes(row.status);
  const tabs: TabItem[] = [
    { id: "overview", label: "Overview" },
    { id: "members", label: "Members", count: row.activeMemberCount },
    ...(showApplications ? [{ id: "applications", label: "Applications", count: row.pendingApplications, alert: true }] : []),
    ...(row.activatedAt ? [{ id: "cycles", label: "Cycles" }, { id: "contributions", label: "Contributions" }] : []),
    ...(row.collectionMode === "RAZORPAY" ? [{ id: "payments", label: "Payments", count: row.payments.reconciliationRequired + row.payments.failed, alert: true }] : []),
    ...(current ? [{ id: "selection", label: row.groupType === "AUCTION" ? "Auction" : "Selection" }] : []),
    ...(row.activatedAt ? [{ id: "payouts", label: "Payouts", count: row.payouts.approvalRequired + row.payouts.approved + row.payouts.failed + row.payouts.reconciliationRequired, alert: true }] : []),
    { id: "ledger", label: "Ledger" }, { id: "activity", label: "Activity" }, { id: "rules", label: "Rules" },
  ];
  const activeTab = tabs.some((t) => t.id === activeTabRaw) ? activeTabRaw : "overview";

  return (
    <div className="stack stack--lg">
      <div className="group-hero" style={{ gap: 12 }}>
        <Breadcrumbs items={crumbs} />
        <div className="group-hero__top">
          <div className="group-hero__title" style={{ gap: 6 }}>
            <div className="row"><CreatorTypeBadge creatorType={row.creatorType} /><GroupTypeBadge type={row.groupType} /><StatusBadge kind="group" value={row.status} /><HealthBadge level={health.level} label={health.label} /></div>
            <h1 className="h-page" style={{ margin: 0 }}>{row.name}</h1>
            <div className="group-hero__meta"><span className="mono text-xs">GRP-{row.id.slice(0, 8).toUpperCase()}</span><span>{row.creatorType === "PLATFORM" ? "Dhanvi platform" : `Organizer: ${row.organizerName ?? "—"}${row.organizerStatus && row.organizerStatus !== "APPROVED" ? ` (${statusLabel("organizer", row.organizerStatus)})` : ""}`}</span><span>{row.collectionMode === "RAZORPAY" ? "Razorpay collection" : "Manual tracking"}</span></div>
          </div>
        </div>
        <FactStrip label="Group facts" items={[
          { label: "Group value", value: <span className="amount">{formatMoney(row.groupValue)}</span> }, { label: "Monthly", value: <span className="amount">{formatMoney(row.monthlyContribution)}</span> },
          { label: "Members", value: `${row.currentMemberCount} / ${row.memberLimit}` }, { label: "Current cycle", value: row.currentCycleNumber ? `${row.currentCycleNumber} of ${row.durationMonths}` : `Starts ${formatDate(row.startDate)}` },
          { label: "Collection", value: current ? `${current.settledMemberCount} / ${current.expectedMemberCount}` : "—" }, { label: "Last activity", value: formatDateTime(row.lastActivityAt) },
        ]} />
      </div>
      {!canManage && <Callout variant="neutral">Organizer-created group: the organizer operates it. Dhanvi monitors and can suspend or cancel from the group menu.</Callout>}
      {editing ? <GroupWizard scope="admin" existing={g} onSaved={() => { setEditing(false); void refresh(); }} onCancel={() => setEditing(false)} /> : (
        <>
          <GroupControlPanel group={g} scope="admin" control={control} cycleId={current?.id} eligibleMembers={row.activeMemberCount} onChanged={refresh} onEdit={() => setEditing(true)} />
          <IssuesPanel issues={s.issues} />
          <Tabs items={tabs} value={activeTab} onChange={setTab} label="Group sections" />
          <TabPanel id="overview" active={activeTab === "overview"}>
            <div className="grid-sidebar">
              <div className="stack stack--lg">
                {current && (
                  <Card>
                    <CardHeader title={`Cycle ${current.cycleNumber} of ${row.durationMonths}`} subtitle={`${statusLabel("selection", current.selectionMethod)} · due ${formatDate(current.contributionDueDate)} · ${row.groupType === "AUCTION" ? "auction" : "selection"} ${formatDate(current.selectionDate)} · payout ${formatDate(current.payoutDate)}`} actions={<StatusBadge kind="cycle" value={current.status} />} />
                    <CardBody className="stack">
                      <div className="grid-3">
                        <StageFact label="Contributions" value={`${current.settledMemberCount} / ${current.expectedMemberCount} settled`} tone={current.outstandingMemberCount === 0 ? "success" : "warning"} />
                        <StageFact label={row.groupType === "AUCTION" ? "Auction" : "Selection"} value={current.selectionResultId ? `#${current.winnerSlotNumber} ${current.winnerName}` : current.auctionStatus ? statusLabel("auction", current.auctionStatus) : current.status === "READY_FOR_SELECTION" ? "Ready" : "Waiting"} tone={current.selectionResultId ? "success" : current.status === "READY_FOR_SELECTION" ? "warning" : "neutral"} />
                        <StageFact label="Payout" value={payoutStage(row.payouts, current)} tone={row.payouts.succeeded > 0 && row.payouts.approvalRequired + row.payouts.approved + row.payouts.failed + row.payouts.reconciliationRequired + row.payouts.pendingBeneficiary + row.payouts.processing === 0 ? "success" : "neutral"} />
                      </div>
                      <ProgressBar value={current.settledAmount} max={current.expectedPoolAmount} label="Collection progress" start={<span className="num"><strong>{formatMoney(current.settledAmount)}</strong> of {formatMoney(current.expectedPoolAmount)}</span>} end={current.collectionMode === "RAZORPAY" ? "Gateway settled" : "Manually recorded"} />
                      {current.status === "COLLECTING_CONTRIBUTIONS" && <OutstandingList items={s.outstandingContributions} mode={current.collectionMode} />}
                    </CardBody>
                  </Card>
                )}
                {!row.activatedAt && (
                  <Card><CardHeader title="Member positions" subtitle={row.termsPendingCount ? `${row.termsPendingCount} approved member${row.termsPendingCount === 1 ? "" : "s"} still need to accept the rules` : "Rules accepted by every approved member"} /><CardBody><ProgressBar value={row.currentMemberCount} max={row.memberLimit} label="Positions filled" start={<strong className="num">{row.currentMemberCount} of {row.memberLimit} positions reserved</strong>} end={row.pendingApplications ? <span className="badge badge--warning">{row.pendingApplications} applications</span> : undefined} /></CardBody></Card>
                )}
                <Card><CardHeader title="Recent activity" actions={<button type="button" className="link text-sm" onClick={() => setTab("activity")}>All activity</button>} /><CardBody><ActivityTimeline activity={s.activity} limit={6} /></CardBody></Card>
              </div>
              <Card><CardHeader title="Tracking" subtitle="Where this group sits" /><CardBody><GroupTrack group={row} cycles={s.cycles} /></CardBody></Card>
            </div>
          </TabPanel>
          <TabPanel id="members" active={activeTab === "members"}>
            {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <GroupMembersTable group={g} members={memberRows} scope="admin" canManage={canManage} mode="members" onChanged={refresh} loading={members.loading && !members.data} presentation="operational" contributions={contributionMap} payoutStatus={payoutByMember} />}
          </TabPanel>
          {showApplications && (
            <TabPanel id="applications" active={activeTab === "applications"}>
              {!canManage && <Callout variant="neutral">Applications to organizer groups are reviewed by the organizer.</Callout>}
              {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <GroupMembersTable group={g} members={memberRows} scope="admin" canManage={canManage} mode="applications" onChanged={refresh} loading={members.loading && !members.data} />}
            </TabPanel>
          )}
          {row.activatedAt && (
            <>
              <TabPanel id="cycles" active={activeTab === "cycles"}><CyclesTable group={row} cycles={s.cycles} /></TabPanel>
              <TabPanel id="contributions" active={activeTab === "contributions"}>
                {current && currentCycleDto ? (
                  <>
                    <div className="row row--between"><h2 className="h-section" style={{ margin: 0 }}>Cycle {current.cycleNumber} contributions</h2><span className="text-sm text-muted">{current.settledMemberCount} of {current.expectedMemberCount} {current.collectionMode === "RAZORPAY" ? "gateway settled" : "recorded"}</span></div>
                    {contributions.error ? <ErrorState message={contributions.error} onRetry={contributions.reload} /> : <CycleContributionsTable group={g} cycle={currentCycleDto} contributions={contributions.data ?? []} scope="admin" onChanged={refresh} compact />}
                  </>
                ) : <Callout variant="neutral">Contribution obligations appear while a cycle is running.</Callout>}
              </TabPanel>
            </>
          )}
          {row.collectionMode === "RAZORPAY" && <TabPanel id="payments" active={activeTab === "payments"}><GroupPaymentIssuesTable issues={s.paymentIssues} counts={row.payments} /></TabPanel>}
          {current && currentCycleDto && (
            <TabPanel id="selection" active={activeTab === "selection"}>
              {current.selectionMethod === "AUCTION" ? <AuctionSummaryCard group={g} cycle={currentCycleDto} href={`/groups/${g.id}/cycles/${current.id}/auction`} viewer="admin" /> : <SelectionPanel group={g} cycle={currentCycleDto} viewer="admin" />}
            </TabPanel>
          )}
          {row.activatedAt && <TabPanel id="payouts" active={activeTab === "payouts"}><GroupPayoutsTable payouts={s.payouts} /><p className="text-sm text-muted"><Link className="link" href={`/payouts?groupId=${g.id}`}>Open in payout operations</Link></p></TabPanel>}
          <TabPanel id="ledger" active={activeTab === "ledger"}><GroupLedgerPanel groupId={g.id} /></TabPanel>
          <TabPanel id="activity" active={activeTab === "activity"}><Card><CardHeader title="Activity" subtitle="Group and payout events, newest first" /><CardBody><ActivityTimeline activity={s.activity} /></CardBody></Card></TabPanel>
          <TabPanel id="rules" active={activeTab === "rules"}>
            <div className="grid-sidebar"><div className="stack stack--lg"><ImportantRulesCard group={g} /><RulesSnapshot group={g} /></div>{row.status === "DRAFT" && canManage ? <Card><CardBody className="stack"><p className="text-sm text-secondary">Rules can still change while the group is a draft.</p><LinkButton href={`/groups/${g.id}`} variant="secondary" size="sm">Edit from Group Control</LinkButton></CardBody></Card> : <div />}</div>
          </TabPanel>
        </>
      )}
    </div>
  );
}

function StageFact({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "neutral" }) {
  return <div className="fact"><span className="fact__label">{label}</span><span className="fact__value"><Badge tone={tone} plain>{value}</Badge></span></div>;
}
function payoutStage(p: { pendingBeneficiary: number; approvalRequired: number; approved: number; processing: number; succeeded: number; failed: number; reconciliationRequired: number; cancelled: number }, c: AdminCycleSnapshot) {
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  if (c.status === "PAYOUT_COMPLETED" || c.status === "COMPLETED") return "Settled";
  if (total === 0) return c.status === "SELECTION_COMPLETED" ? (c.collectionMode === "RAZORPAY" ? "Not prepared" : "No gateway payout") : "Not started";
  if (p.reconciliationRequired) return `${p.reconciliationRequired} mismatch`; if (p.failed) return `${p.failed} failed`;
  if (p.approvalRequired) return `${p.approvalRequired} awaiting approval`; if (p.approved) return `${p.approved} ready to execute`;
  if (p.pendingBeneficiary) return `${p.pendingBeneficiary} awaiting bank account`; if (p.processing) return `${p.processing} processing`;
  return `${p.succeeded} succeeded`;
}

function CyclesTable({ group, cycles }: { group: { id: string; durationMonths: number; currentCycleNumber: number | null }; cycles: AdminCycleSnapshot[] }) {
  const columns: Column<AdminCycleSnapshot>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (c) => <span className="text-strong">Cycle {c.cycleNumber}{c.cycleNumber === group.currentCycleNumber ? <span className="badge badge--success badge--plain" style={{ marginLeft: 8 }}>Current</span> : null}</span> },
    { key: "status", header: "Stage", render: (c) => <StatusBadge kind="cycle" value={c.status} /> },
    { key: "dates", header: "Due · selection · payout", render: (c) => <span className="text-xs">{formatDate(c.contributionDueDate)} · {formatDate(c.selectionDate)} · {formatDate(c.payoutDate)}</span> },
    { key: "collection", header: "Collection", render: (c) => c.status === "UPCOMING" ? <span className="text-muted">—</span> : <span className="num">{c.settledMemberCount} / {c.expectedMemberCount}<span className="cell__sub">{formatMoney(c.settledAmount)} of {formatMoney(c.expectedPoolAmount)}</span></span> },
    { key: "selection", header: "Selection", render: (c) => c.selectionResultId ? <>#{c.winnerSlotNumber} {c.winnerName}<span className="cell__sub">{statusLabel("selection", c.selectionMethod)} · {formatDate(c.selectionCompletedAt)}</span></> : c.auctionStatus ? <>{statusLabel("auction", c.auctionStatus)}<span className="cell__sub">{c.auctionBidCount} bid{c.auctionBidCount === 1 ? "" : "s"}</span></> : <span className="text-muted">{statusLabel("selection", c.selectionMethod)}</span> },
    { key: "completed", header: "Completed", render: (c) => c.completedAt ? formatDate(c.completedAt) : <span className="text-muted">—</span> },
    { key: "actions", header: "", actions: true, render: (c) => c.status === "UPCOMING" ? null : <span className="row" style={{ gap: 8 }}><Link className="link text-sm" href={`/groups/${group.id}/cycles/${c.id}/contributions`}>Contributions</Link>{c.selectionMethod === "AUCTION" && <Link className="link text-sm" href={`/groups/${group.id}/cycles/${c.id}/auction`}>Auction</Link>}</span> },
  ];
  return <DataTable columns={columns} rows={cycles} rowKey={(c) => c.id} caption="Cycles" compact empty={{ title: "No cycles" }} />;
}

