"use client";
import { managePrefix } from "../groups/shared";
import { CycleSettlement } from "../payouts/cycle-settlement";
import { AuctionPanel } from "../auctions/auction-panel";
import { SelectionPanel } from "../selections/selection-panel";
import { contributionService, type GroupScope } from "@dhanvi/api-client";
import type { Group, Contribution, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, formatNumber, statusLabel } from "@dhanvi/utils";
import { Card, CardBody, CardHeader, StatusBadge, ProgressBar, DataTable, type Column, Callout, ErrorState, SkeletonText, Fact, Icons } from "@dhanvi/ui";
import { WorkflowStatusCard, cycleSummary } from "../workflow";
import Link from "next/link";
import { ContributionSummaryCard } from "./contribution-card";

export function CycleProgress({ cycle }: { cycle: MonthlyCycle }) {
  const financial = cycle.collectionMode === "RAZORPAY";
  const amount = financial ? cycle.financiallySettledAmount : cycle.recordedContributionAmount;
  const members = financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount;
  return (
    <ProgressBar value={amount} max={cycle.expectedPoolAmount} label={`Cycle ${cycle.cycleNumber} contributions ${financial ? "gateway settled" : "recorded"}`}
      start={<><strong className="num">{members} / {cycle.expectedMemberCount}</strong> members complete · {formatNumber(cycle.expectedMemberCount - members)} pending</>}
      end={<span className="amount" style={{ fontWeight: 500 }}>{formatMoney(amount)} / {formatMoney(cycle.expectedPoolAmount)}</span>} />
  );
}

const scopePrefix = managePrefix;

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
            <WorkflowStatusCard summary={cycleSummary(current, group, management ? (scope as "admin" | "organizer") : "member", own)} viewer={management ? (scope as "admin" | "organizer") : "member"} title={`Cycle ${current.cycleNumber} progress`} stepperLabel="Cycle steps" />
            <div className="stack">
              <CycleProgress cycle={current} />
              {own && <ContributionSummaryCard contribution={own} compact />}
              {management && <div className="row"><Link className="btn btn--secondary btn--sm" href={`${managePrefix(scope)}/groups/${group.id}/cycles/${current.id}/contributions`}><Icons.Wallet size={16} /> Manage contributions</Link></div>}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Callout variant="neutral" title="No cycle is running right now">{group.status === "COMPLETED" ? "All cycles are complete. No further contributions are required." : "The schedule appears here once the group is activated."}</Callout>
      )}
      {current && (current.selectionMethod === "AUCTION" ? <AuctionPanel group={group} cycle={current} scope={scope} /> : <SelectionPanel group={group} cycle={current} scope={scope} onCompleted={async () => { await reload(); await onChanged?.(); }} />)}
      {current?.selectionResultId && <CycleSettlement cycleId={current.id} groupId={group.id} scope={scope} />}
      {showSchedule && (
        <div className="section">
          <div className="section__header"><h2 className="h-section">Full schedule</h2>{hasMembership && <Link className="link" href={`/contributions?groupId=${group.id}`}>My contribution history →</Link>}</div>
          <DataTable columns={columns} rows={cycles} rowKey={(c) => c.id} caption="Monthly cycle schedule" empty={{ title: "No cycles scheduled yet" }} />
        </div>
      )}
    </div>
  );
}
