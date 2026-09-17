"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@dhanvi/auth";
import { auctionService, groupService, contributionService, payoutService } from "@dhanvi/api-client";
import type { Contribution, Member, Payout } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, humanize } from "@dhanvi/utils";
import { CreatorTypeBadge, GroupTypeBadge, StatusBadge, Breadcrumbs, Card, CardBody, CardHeader, Callout, DataTable, type Column, ErrorState, FactStrip, ProgressBar, Tabs, TabPanel, type TabItem, PageSkeleton, Badge } from "@dhanvi/ui";
import { GroupWizard } from "./group-wizard";
import { ImportantRulesCard, RulesSnapshot } from "./group-rules-card";
import { GroupMembersTable, termsAccepted } from "./group-members-table";
import { GroupControlPanel } from "./group-control-panel";
import { CycleContributionsTable } from "../contributions/manage-contributions";
import { CycleProgress, CycleScheduleTable } from "../contributions/cycle-progress";
import { AuctionSummaryCard } from "../auctions/auction-summary-card";
import { SelectionPanel } from "../selections/selection-panel";
import { cycleFacts, deriveGroupControl, WorkflowStepper, groupSteps } from "../workflow";
import { useTabParam } from "../layout/use-tab";

const ORGANIZER_TABS = ["overview", "applications", "members", "contributions", "cycle", "selection", "payouts", "rules"] as const;

/**
 * Organizer portal group page: own-group operations only. One control panel with the single valid action,
 * then Applications / Members / Contributions / Cycle / Selection or Auction / Payout status / Rules.
 */
export function OrganizerGroupDetail({ applications = false }: { applications?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const [tabRaw, setTab] = useTabParam(applications ? "applications" : "overview", ORGANIZER_TABS);
  const [editing, setEditing] = useState(false);
  const group = useAsyncData(() => groupService.details(id, "organizer"), [id, auth.user?.id]);
  const members = useAsyncData(() => groupService.members(id, "organizer"), [id]);
  const g = group.data;
  const cycles = useAsyncData(() => contributionService.cycles(id, "organizer"), [id], !!g?.activatedAt);
  const currentCycle = cycles.data?.find((c) => c.cycleNumber === g?.currentCycleNumber);
  const contributions = useAsyncData(() => contributionService.cycleContributions("organizer", id, currentCycle!.id), [id, currentCycle?.id], !!currentCycle);
  const auctionLive = !!currentCycle && currentCycle.selectionMethod === "AUCTION" && ["READY_FOR_SELECTION", "CONTRIBUTIONS_COMPLETE"].includes(currentCycle.status);
  const auction = useAsyncData(() => auctionService.get(id, currentCycle!.id), [id, currentCycle?.id], auctionLive);
  const payouts = useAsyncData(() => payoutService.group(id, 1), [id], !!g?.activatedAt);
  async function refresh() { await Promise.all([group.reload(), members.reload(), g?.activatedAt ? cycles.reload() : Promise.resolve(), currentCycle ? contributions.reload() : Promise.resolve(), auctionLive ? auction.reload() : Promise.resolve()]); }

  if (group.error) return <div className="stack"><Breadcrumbs items={[{ label: "My groups", href: "/organizer/groups" }, { label: "Group" }]} /><ErrorState message={group.error} onRetry={group.reload} /></div>;
  if (!g) return <PageSkeleton />;
  const memberRows: Member[] = members.data ?? [];
  const pendingApplications = memberRows.filter((m) => m.status === "APPLIED").length;
  const termsPending = memberRows.filter((m) => m.status === "APPROVED" && !termsAccepted(m, g)).length;
  const activeMembers = memberRows.filter((m) => !["APPLIED", "REJECTED"].includes(m.status)).length;
  const canManage = g.organizer?.status === "APPROVED";
  const control = deriveGroupControl({
    group: g, viewer: "organizer", canManage, pendingApplications, termsPending,
    currentCycle: currentCycle ? cycleFacts(currentCycle, auction.data?.status ?? (auctionLive ? "SCHEDULED" : null)) : undefined,
    auction: auction.data ? { canOpen: auction.data.canOpen, canClose: auction.data.canClose } : null,
    hrefs: { group: `/organizer/groups/${g.id}`, applications: `/organizer/groups/${g.id}/applications`, contributions: (c) => `/organizer/groups/${g.id}/cycles/${c}/contributions`, auction: (c) => `/organizer/groups/${g.id}/cycles/${c}/auction`, payouts: `/organizer/groups/${g.id}/payouts` },
  });
  const contributionMap = new Map<string, Contribution>((contributions.data ?? []).map((c) => [c.membershipId, c]));
  const tabs: TabItem[] = [
    { id: "overview", label: "Overview" },
    { id: "applications", label: "Applications", count: pendingApplications, alert: true },
    { id: "members", label: "Members", count: activeMembers },
    ...(currentCycle ? [{ id: "contributions", label: "Contributions" }, { id: "cycle", label: "Cycle" }, { id: "selection", label: currentCycle.selectionMethod === "AUCTION" ? "Auction" : "Selection" }, { id: "payouts", label: "Payout status" }] : []),
    { id: "rules", label: "Rules" },
  ];
  const activeTab = tabs.some((t) => t.id === tabRaw) ? tabRaw : "overview";
  const full = g.currentMemberCount >= g.memberLimit;

  return (
    <div className="stack stack--lg">
      <div className="group-hero">
        <Breadcrumbs items={[{ label: "My groups", href: "/organizer/groups" }, { label: g.name }]} />
        <div className="group-hero__title">
          <div className="row"><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} /><CreatorTypeBadge creatorType={g.creatorType} /></div>
          <h1 className="h-page">{g.name}</h1>
        </div>
        <FactStrip label="Group summary" items={[
          { label: "Group value", value: <span className="amount">{formatMoney(g.groupValue)}</span> }, { label: "Monthly contribution", value: <span className="amount">{formatMoney(g.monthlyContribution)}</span> },
          { label: "Members", value: `${g.currentMemberCount} of ${g.memberLimit}` }, { label: "Current cycle", value: g.currentCycleNumber ? `${g.currentCycleNumber} of ${g.durationMonths}` : `Starts ${formatDate(g.startDate)}` },
          { label: "Rules", value: g.rulesVersion ? `v${g.rulesVersion}${g.rulesLocked ? " · locked" : ""}` : "Draft" },
        ]} />
      </div>
      {g.statusReason && (g.status === "SUSPENDED" || g.status === "CANCELLED") && <Callout variant="warning" title={`${humanize(g.status)} by Dhanvi`}>{g.statusReason}</Callout>}
      {!canManage && <Callout variant="warning" title="Organizer access is not active">You can view this group but cannot operate it until your organizer status is approved.</Callout>}

      {editing ? <GroupWizard scope="organizer" existing={g} onSaved={() => { setEditing(false); void refresh(); }} onCancel={() => setEditing(false)} /> : (
        <>
          <GroupControlPanel group={g} scope="organizer" control={control} cycleId={currentCycle?.id} onChanged={refresh} onEdit={() => setEditing(true)} />
          <Tabs items={tabs} value={activeTab} onChange={setTab} label="Group sections" />
          <TabPanel id="overview" active={activeTab === "overview"}>
            <div className="grid-sidebar">
              <div className="stack stack--lg">
                <Card>
                  <CardHeader title="Member positions" subtitle={full ? "Fully subscribed" : `${g.availableSlots} position${g.availableSlots === 1 ? "" : "s"} open`} />
                  <CardBody className="stack">
                    <ProgressBar value={g.currentMemberCount} max={g.memberLimit} label="Member positions filled" tone={full ? "indigo" : undefined} start={<strong className="num">{g.currentMemberCount} of {g.memberLimit} joined</strong>} end={termsPending ? <span className="badge badge--warning">{termsPending} to accept rules</span> : undefined} />
                    {currentCycle && <CycleProgress cycle={currentCycle} />}
                  </CardBody>
                </Card>
                <ImportantRulesCard group={g} />
              </div>
              <Card><CardHeader title="Lifecycle" /><CardBody><WorkflowStepper steps={groupSteps(g, currentCycle)} label="Group lifecycle" /></CardBody></Card>
            </div>
          </TabPanel>
          <TabPanel id="applications" active={activeTab === "applications"}>
            {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <GroupMembersTable group={g} members={memberRows} scope="organizer" canManage={canManage} mode="applications" onChanged={refresh} loading={members.loading && !members.data} />}
          </TabPanel>
          <TabPanel id="members" active={activeTab === "members"}>
            {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <GroupMembersTable group={g} members={memberRows} scope="organizer" canManage={canManage} mode="members" onChanged={refresh} loading={members.loading && !members.data} presentation="operational" contributions={contributionMap} />}
          </TabPanel>
          {currentCycle && (
            <>
              <TabPanel id="contributions" active={activeTab === "contributions"}>
                <Card><CardHeader title={`Cycle ${currentCycle.cycleNumber} contributions`} subtitle={`Due ${formatDate(currentCycle.contributionDueDate)}`} /><CardBody><CycleProgress cycle={currentCycle} /></CardBody></Card>
                {contributions.error ? <ErrorState message={contributions.error} onRetry={contributions.reload} /> : <CycleContributionsTable group={g} cycle={currentCycle} contributions={contributions.data ?? []} scope="organizer" onChanged={refresh} />}
              </TabPanel>
              <TabPanel id="cycle" active={activeTab === "cycle"}>
                {cycles.data && <CycleScheduleTable group={g} cycles={cycles.data} scope="organizer" />}
              </TabPanel>
              <TabPanel id="selection" active={activeTab === "selection"}>
                {currentCycle.selectionMethod === "AUCTION" ? <AuctionSummaryCard group={g} cycle={currentCycle} href={`/organizer/groups/${g.id}/cycles/${currentCycle.id}/auction`} viewer="organizer" /> : <SelectionPanel group={g} cycle={currentCycle} viewer="organizer" />}
              </TabPanel>
              <TabPanel id="payouts" active={activeTab === "payouts"}>
                <OrganizerPayoutStatus payouts={payouts.data?.items ?? []} loading={payouts.loading && !payouts.data} error={payouts.error} onRetry={payouts.reload} />
              </TabPanel>
            </>
          )}
          <TabPanel id="rules" active={activeTab === "rules"}>
            <div className="grid-sidebar"><div className="stack stack--lg"><ImportantRulesCard group={g} /><RulesSnapshot group={g} /></div><div /></div>
          </TabPanel>
        </>
      )}
    </div>
  );
}

function OrganizerPayoutStatus({ payouts, loading, error, onRetry }: { payouts: Payout[]; loading: boolean; error: string; onRetry: () => void }) {
  const columns: Column<Payout>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (p) => <span className="text-strong">Cycle {p.cycleNumber}</span> },
    { key: "recipient", header: "Recipient", render: (p) => p.memberName },
    { key: "type", header: "Type", render: (p) => humanize(p.payoutType) },
    { key: "amount", header: "Amount", align: "right", render: (p) => <span className="amount">{formatMoney(p.amount)}</span> },
    { key: "status", header: "Status", render: (p) => <Badge tone={p.status === "SUCCEEDED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(p.status) ? "warning" : "neutral"}>{["FAILED", "RECONCILIATION_REQUIRED"].includes(p.status) ? "Under review by Dhanvi" : humanize(p.status)}</Badge> },
  ];
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <div className="stack">
      <p className="text-sm text-secondary">Dhanvi prepares, approves and executes payouts. You can follow their status here; no action is required from you.</p>
      <DataTable columns={columns} rows={loading ? undefined : payouts} loading={loading} rowKey={(p) => p.id} caption="Group payouts" empty={{ title: "No payouts yet", description: "Payouts appear after a cycle's selection is completed and Dhanvi prepares them." }} />
    </div>
  );
}
