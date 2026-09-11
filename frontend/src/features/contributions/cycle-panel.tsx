"use client";
import Link from "next/link";
import { AuctionPanel } from "@/features/auctions/auction-panel";
import { SelectionPanel } from "@/features/selections/selection-panel";
import { contributionService } from "@/services/contribution.service";
import type { GroupScope } from "@/services/group.service";
import type { Group } from "@/types/group";
import type { Contribution, MonthlyCycle } from "@/types/contribution";
import { useAsyncData } from "@/hooks/use-async-data";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Timeline, type TimelineStep } from "@/components/ui/timeline";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout, ErrorState } from "@/components/ui/callout";
import { SkeletonText } from "@/components/ui/skeleton";
import { Fact } from "@/components/ui/description";
import { Icons } from "@/components/ui/icons";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { ContributionSummaryCard } from "./contribution-card";

export function CycleProgress({ cycle }: { cycle: MonthlyCycle }) {
  return (
    <ProgressBar value={cycle.recordedContributionAmount} max={cycle.expectedPoolAmount} label={`Cycle ${cycle.cycleNumber} contributions recorded`}
      start={<><strong className="num">{cycle.fullyRecordedMemberCount} / {cycle.expectedMemberCount}</strong> members complete · {formatNumber(cycle.pendingMemberCount)} pending</>}
      end={<span className="amount" style={{ fontWeight: 500 }}>{formatMoney(cycle.recordedContributionAmount)} / {formatMoney(cycle.expectedPoolAmount)}</span>} />
  );
}

export function cycleTimeline(cycle: MonthlyCycle): TimelineStep[] {
  const order = ["COLLECTING_CONTRIBUTIONS", "READY_FOR_SELECTION", "SELECTION_COMPLETED", "PAYOUT_PENDING"] as const;
  const rank: Record<string, number> = { UPCOMING: -1, COLLECTING_CONTRIBUTIONS: 0, CONTRIBUTIONS_COMPLETE: 1, READY_FOR_SELECTION: 1, SELECTION_COMPLETED: 2, PAYOUT_PENDING: 3, PAYOUT_COMPLETED: 4, COMPLETED: 4, SUSPENDED: -2 };
  const current = rank[cycle.status] ?? -1;
  const labels: Record<(typeof order)[number], [string, string]> = {
    COLLECTING_CONTRIBUTIONS: ["Collecting contributions", `Due ${formatDate(cycle.contributionDueDate)}`],
    READY_FOR_SELECTION: ["Ready for selection", cycle.selectionMethod === "AUCTION" ? `Auction on ${formatDate(cycle.selectionDate)}` : `${statusLabel("selection", cycle.selectionMethod)} on ${formatDate(cycle.selectionDate)}`],
    SELECTION_COMPLETED: ["Selection completed", cycle.selectionCompletedAt ? `Recorded ${formatDate(cycle.selectionCompletedAt, cycle.groupTimeZone)}` : "Payout recipient recorded"],
    PAYOUT_PENDING: ["Payout pending", `Scheduled ${formatDate(cycle.payoutDate)} · not processed by Dhanvi`],
  };
  return order.map((status, index) => ({ id: status, title: labels[status][0], description: labels[status][1], state: index < current ? "done" : index === current ? "current" : "upcoming" }));
}

const scopePrefix = (scope: GroupScope) => (scope === "organizer" || scope === "admin" ? `/${scope}` : "");

export function CyclePanel({ group, scope, showSchedule = true, onChanged }: { group: Group; scope: GroupScope; showSchedule?: boolean; onChanged?: () => Promise<void> }) {
  const management = scope === "organizer" || scope === "admin";
  const hasMembership = group.myMembership?.status === "ACTIVE";
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [cycles, mine] = await Promise.all([
      contributionService.cycles(group.id, management ? (scope as "admin" | "organizer") : undefined),
      hasMembership ? contributionService.myGroup(group.id) : Promise.resolve([] as Contribution[]),
    ]);
    return { cycles, mine };
  }, [group.id, management, scope, hasMembership]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Card><CardBody><SkeletonText lines={4} /></CardBody></Card>;
  const { cycles, mine } = data;
  const current = cycles.find((c) => c.cycleNumber === group.currentCycleNumber);
  const own = mine.find((c) => c.cycleId === current?.id);

  const columns: Column<MonthlyCycle>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (c) => <span className="text-strong">Cycle {c.cycleNumber}{c.cycleNumber === group.currentCycleNumber ? <span className="badge badge--success badge--plain" style={{ marginLeft: 8 }}>Current</span> : null}</span> },
    { key: "due", header: "Contribution due", render: (c) => formatDate(c.contributionDueDate) },
    { key: "selection", header: "Selection", render: (c) => <>{formatDate(c.selectionDate)}<span className="cell__sub">{statusLabel("selection", c.selectionMethod)}</span></> },
    { key: "payout", header: "Payout date", render: (c) => formatDate(c.payoutDate) },
    { key: "status", header: "Status", render: (c) => <StatusBadge kind="cycle" value={c.status} /> },
    management
      ? { key: "actions", header: "Actions", actions: true, render: (c) => <span className="row" style={{ gap: 12 }}>{c.selectionMethod === "AUCTION" && <Link className="link" href={`${scopePrefix(scope)}/groups/${group.id}/cycles/${c.id}/auction`}>Auction</Link>}<Link className="link" href={`/${scope}/groups/${group.id}/cycles/${c.id}/contributions`}>Contributions</Link></span> }
      : { key: "mine", header: "My contribution", render: (c) => { const record = mine.find((m) => m.cycleId === c.id); return record ? <StatusBadge kind="contribution" value={record.status} /> : <span className="text-muted">—</span>; } },
  ];

  return (
    <div className="stack stack--lg">
      {group.status === "SUSPENDED" && <Callout variant="warning" title="Group suspended">The schedule and history are preserved. New contribution records, selections and bids are blocked until the group is resumed.</Callout>}
      {current ? (
        <Card>
          <CardHeader title={`Cycle ${current.cycleNumber} of ${group.durationMonths}`} subtitle={`${statusLabel("selection", current.selectionMethod)} · business dates in ${group.groupTimeZone}`} actions={<StatusBadge kind="cycle" value={current.status} />} />
          <CardBody className="stack stack--lg">
            <div className="grid-4">
              <Fact label="Contribution due" value={formatDate(current.contributionDueDate)} />
              <Fact label={current.selectionMethod === "AUCTION" ? "Auction date" : "Selection date"} value={formatDate(current.selectionDate)} />
              <Fact label="Payout date" value={formatDate(current.payoutDate)} />
              <Fact label="Per member" value={formatMoney(current.expectedContributionPerMember)} />
            </div>
            <div className="grid-sidebar" style={{ gridTemplateColumns: "minmax(0, 1fr) 280px" }}>
              <div className="stack">
                <CycleProgress cycle={current} />
                {own && <ContributionSummaryCard contribution={own} compact />}
                {management && <div className="row"><Link className="btn btn--secondary btn--sm" href={`/${scope}/groups/${group.id}/cycles/${current.id}/contributions`}><Icons.Wallet size={16} /> Manage contributions</Link></div>}
              </div>
              <Timeline steps={cycleTimeline(current)} />
            </div>
          </CardBody>
        </Card>
      ) : (
        <Callout variant="neutral">No cycle is currently active for this group.</Callout>
      )}
      {current && (current.selectionMethod === "AUCTION" ? <AuctionPanel group={group} cycle={current} scope={scope} /> : <SelectionPanel group={group} cycle={current} scope={scope} onCompleted={async () => { await reload(); await onChanged?.(); }} />)}
      {showSchedule && (
        <div className="section">
          <div className="section__header"><h2 className="h-section">Full schedule</h2>{hasMembership && <Link className="link" href={`/contributions?groupId=${group.id}`}>My contribution history →</Link>}</div>
          <DataTable columns={columns} rows={cycles} rowKey={(c) => c.id} caption="Monthly cycle schedule" empty={{ title: "No cycles scheduled yet" }} />
        </div>
      )}
    </div>
  );
}
