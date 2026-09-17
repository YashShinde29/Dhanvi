"use client";
import { CyclePayoutStatus } from "../payouts/cycle-settlement";
import { AuctionSummaryCard } from "../auctions/auction-summary-card";
import { SelectionPanel } from "../selections/selection-panel";
import type { GroupScope } from "@dhanvi/api-client";
import type { Group, Contribution, MonthlyCycle } from "@dhanvi/types";
import { formatDate, statusLabel } from "@dhanvi/utils";
import { Card, CardBody, CardHeader, StatusBadge, Callout, Fact } from "@dhanvi/ui";
import { CycleProgress } from "./cycle-progress";
import { WorkflowStatusCard, cycleSummary } from "../workflow";
import { ContributionSummaryCard } from "./contribution-card";

/**
 * The member's view of the running cycle: where it stands, their own contribution, the selection or auction, and
 * their payout for that cycle. Operators use their own control panel; this panel never renders commands.
 */
export function MemberCyclePanel({ group, cycles, mine, scope = "public" }: { group: Group; cycles: MonthlyCycle[]; mine: Contribution[]; scope?: GroupScope }) {
  const current = cycles.find((c) => c.cycleNumber === group.currentCycleNumber);
  const own = mine.find((c) => c.cycleId === current?.id);
  return (
    <div className="stack stack--lg">
      {group.status === "SUSPENDED" && <Callout variant="warning" title="Group paused">Dhanvi has paused this group. Your schedule and history are preserved; no contribution is due until it resumes.</Callout>}
      {current ? (
        <Card>
          <CardHeader title={`Cycle ${current.cycleNumber} of ${group.durationMonths}`} subtitle={`${statusLabel("selection", current.selectionMethod)} · dates in ${group.groupTimeZone}`} actions={<StatusBadge kind="cycle" value={current.status} />} />
          <CardBody className="stack stack--lg">
            <div className="grid-3">
              <Fact label="Contribution due" value={formatDate(current.contributionDueDate)} />
              <Fact label={current.selectionMethod === "AUCTION" ? "Auction date" : "Selection date"} value={formatDate(current.selectionDate)} />
              <Fact label="Payout date" value={formatDate(current.payoutDate)} />
            </div>
            <WorkflowStatusCard summary={cycleSummary(current, group, "member", own)} viewer="member" title={`Cycle ${current.cycleNumber} progress`} stepperLabel="Cycle steps" bare />
            <CycleProgress cycle={current} />
          </CardBody>
        </Card>
      ) : (
        <Callout variant="neutral" title="No cycle is running right now">{group.status === "COMPLETED" ? "All cycles are complete. No further contributions are required." : "The schedule appears here once the group starts."}</Callout>
      )}
      {own && <ContributionSummaryCard contribution={own} />}
      {current && (current.selectionMethod === "AUCTION" ? <AuctionSummaryCard group={group} cycle={current} href={`/groups/${group.id}/cycles/${current.id}/auction`} viewer="member" /> : <SelectionPanel group={group} cycle={current} viewer="member" />)}
      {current?.selectionResultId && <CyclePayoutStatus cycleId={current.id} groupId={group.id} scope={scope} />}
    </div>
  );
}
