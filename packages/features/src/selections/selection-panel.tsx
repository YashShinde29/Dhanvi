"use client";
import { selectionService } from "@dhanvi/api-client";
import type { Group, MonthlyCycle, SelectionResult } from "@dhanvi/types";
import { LinkButton, Callout, Card, CardBody, CardHeader, Fact, Icons, SkeletonText } from "@dhanvi/ui";
import { formatDate, formatDateTime, formatMoney, statusLabel, useAsyncData } from "@dhanvi/utils";
import { WaitingState } from "../workflow/next-action-card";

/**
 * Selection status and result for one cycle. Display only: the "Start selection" command lives in the operator's
 * Group Control panel so the page has a single primary action.
 */
export function SelectionPanel({ group, cycle, viewer = "member" }: { group: Group; cycle: MonthlyCycle; viewer?: "member" | "organizer" | "admin" }) {
  const hasResult = !!cycle.selectionResultId || ["SELECTION_COMPLETED", "PAYOUT_PENDING", "COMPLETED", "PAYOUT_COMPLETED"].includes(cycle.status);
  const loaded = useAsyncData(() => selectionService.get(group.id, cycle.id), [group.id, cycle.id, cycle.selectionResultId], hasResult);
  const result: SelectionResult | undefined = hasResult ? loaded.data : undefined;
  const error = hasResult ? loaded.error : "";
  const reserved = cycle.selectionMethod === "ORGANIZER_RESERVED";
  const financial = cycle.collectionMode === "RAZORPAY";
  const pendingMembers = cycle.expectedMemberCount - (financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount);
  const operator = group.creatorType === "PLATFORM" ? "Dhanvi admin" : "the organizer";
  const title = reserved ? "Organizer-reserved payout" : "Random selection";
  const icon = reserved ? <Icons.BadgeCheck size={18} style={{ color: "var(--color-warning)" }} /> : <Icons.Shuffle size={18} style={{ color: "var(--color-primary-700)" }} />;

  if (result) {
    return (
      <Card>
        <CardHeader title={<span className="row" style={{ gap: 8 }}>{icon} {reserved ? "Organizer payout recorded" : "Selection completed"}</span>} subtitle={`Cycle ${result.cycleNumber} · ${statusLabel("selection", result.selectionMethod)}`} />
        <CardBody className="stack stack--lg">
          <div className="result-hero">
            <span className="check-anim"><Icons.Check size={28} /></span>
            <span className="result-hero__label">Selected member</span>
            <span className="result-hero__name">Member #{result.winner.slotNumber} — {result.winner.displayName}</span>
            <span className="result-hero__slot">Payout right · <strong className="amount">{formatMoney(cycle.expectedPoolAmount)}</strong> · transfer status under Payouts</span>
          </div>
          <div className="grid-3" style={{ gap: 12 }}>
            <Fact label="Executed" value={formatDateTime(result.executedAt, group.groupTimeZone)} />
            <Fact label="Eligible members" value={result.eligibleMemberCount} />
            <Fact label="Algorithm" value={<code className="mono" style={{ fontSize: "0.85em" }}>{result.algorithmVersion}</code>} />
          </div>
          {result.verificationAvailable && viewer === "member" && <div className="row"><LinkButton href={`/groups/${group.id}/cycles/${cycle.id}/selection/verify`} variant="secondary" icon={<Icons.ShieldCheck size={16} />}>Verify draw</LinkButton></div>}
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title={<span className="row" style={{ gap: 8 }}>{icon} {title}</span>} subtitle={`Cycle ${cycle.cycleNumber} · scheduled ${formatDate(cycle.selectionDate)}`} />
      <CardBody className="stack">
        {error && <Callout variant="danger">{error}</Callout>}
        {hasResult && !error ? <SkeletonText lines={2} />
          : cycle.status === "READY_FOR_SELECTION" ? (
            viewer === "member"
              ? <WaitingState who={operator}>{reserved ? "They record the organizer-reserved payout right." : "They start the random selection."} No action is required from you.</WaitingState>
              : <Callout variant="success" title="All required contributions are settled">{reserved ? "The organizer-reserved payout right can be recorded from Group Control." : "The random selection can be started from Group Control."}</Callout>
          ) : cycle.status === "COLLECTING_CONTRIBUTIONS" || cycle.status === "UPCOMING" ? (
            <WaitingState who={`${pendingMembers} remaining member${pendingMembers === 1 ? "" : "s"}`}>Selection becomes available once every contribution is {financial ? "paid" : "recorded"}.</WaitingState>
          ) : group.status === "SUSPENDED" ? <Callout variant="warning">The group is suspended. Selections are blocked until it is resumed.</Callout>
          : <p className="text-sm text-secondary">Selection is not available in this cycle state.</p>}
      </CardBody>
    </Card>
  );
}
