"use client";
import { managePrefix } from "../groups/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { selectionService, type GroupScope } from "@dhanvi/api-client";
import type { Group, MonthlyCycle, SelectionResult } from "@dhanvi/types";
import { Button, LinkButton, Callout, Card, CardBody, CardHeader, Fact, RuleList, Icons, SkeletonText, useToast, useConfirm } from "@dhanvi/ui";
import { friendlyError, formatDate, formatDateTime, formatMoney, statusLabel } from "@dhanvi/utils";
import { UnavailableAction, WaitingState } from "../workflow/next-action-card";

export function SelectionPanel({ group, cycle, scope, onCompleted }: { group: Group; cycle: MonthlyCycle; scope: GroupScope; onCompleted?: () => Promise<void> | void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [result, setResult] = useState<SelectionResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canExecute = group.status === "ACTIVE" && ((scope === "admin" && group.creatorType === "PLATFORM") || (scope === "organizer" && group.organizer?.status === "APPROVED"));
  const reserved = cycle.selectionMethod === "ORGANIZER_RESERVED";
  const financial = cycle.collectionMode === "RAZORPAY";
  const pendingMembers = cycle.expectedMemberCount - (financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount);
  const responsible = group.creatorType === "PLATFORM" ? "the Dhanvi admin" : "the organizer";
  const executeLabel = reserved ? "Record organizer payout" : "Execute random draw";

  useEffect(() => {
    let active = true;
    if (cycle.status === "SELECTION_COMPLETED" || cycle.selectionResultId)
      selectionService.get(group.id, cycle.id).then((r) => { if (active) setResult(r); }).catch((e) => { if (active) setError(friendlyError(e)); });
    return () => { active = false; };
  }, [group.id, cycle.id, cycle.status, cycle.selectionResultId]);

  async function execute() {
    setBusy(true); setError("");
    try {
      const preview = await selectionService.preview(group.id, cycle.id);
      const decision = await confirm(reserved
        ? { title: "Record the organizer-reserved payout right", description: "This group's published rules reserve the first cycle payout right for the organizer. Executing records that selection; no actual payout is processed.",
            details: <RuleList items={[{ key: "Organizer", value: group.organizer?.name ?? "Organizer" }, { key: "Group value", value: formatMoney(group.groupValue) }, { key: "Cycle", value: `${cycle.cycleNumber}` }]} />, confirmLabel: "Record selection" }
        : { title: `Execute the cycle ${cycle.cycleNumber} random draw?`, description: "The draw is recorded with a seed commitment and eligible set so it can be re-verified. Once executed, the result is final and cannot be edited. No actual payout is processed.",
            details: <RuleList items={[{ key: "Group", value: group.name }, { key: "Eligible members", value: `${preview.eligibleMemberCount}` }, { key: "Algorithm", value: preview.algorithmVersion }, { key: "Selection date", value: `${formatDate(cycle.selectionDate)} (${group.groupTimeZone})` }]} />, confirmLabel: "Execute random draw" });
      if (!decision.confirmed) { setBusy(false); return; }
      const selected = await selectionService.execute(group.id, cycle.id);
      setResult(selected);
      toast.success(reserved ? "Organizer payout right recorded ✓" : "Random draw completed ✓", `Member #${selected.winner.slotNumber} — ${selected.winner.displayName}. Next: payout preparation.`);
      await onCompleted?.();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const title = reserved ? "Organizer-reserved payout" : "Random selection";
  const icon = reserved ? <Icons.BadgeCheck size={18} style={{ color: "var(--color-warning)" }} /> : <Icons.Shuffle size={18} style={{ color: "var(--color-primary-700)" }} />;

  if (result) {
    return (
      <Card>
        <CardHeader title={<span className="row" style={{ gap: 8 }}>{icon} {reserved ? "Organizer payout recorded" : "Random selection completed"}</span>} subtitle={`Cycle ${result.cycleNumber} · ${statusLabel("selection", result.selectionMethod)}`} />
        <CardBody className="stack stack--lg">
          <div className="result-hero">
            <span className="check-anim"><Icons.Check size={28} /></span>
            <span className="result-hero__label">Selected member</span>
            <span className="result-hero__name">Member #{result.winner.slotNumber} — {result.winner.displayName}</span>
            <span className="result-hero__slot">Selected for payout · <strong className="amount">{formatMoney(cycle.expectedPoolAmount)}</strong> · see payout settlement for transfer status</span>
          </div>
          <div className="grid-3" style={{ gap: 12 }}>
            <Fact label="Executed" value={formatDateTime(result.executedAt, group.groupTimeZone)} />
            <Fact label="Eligible members" value={result.eligibleMemberCount} />
            <Fact label="Algorithm" value={<code className="mono" style={{ fontSize: "0.85em" }}>{result.algorithmVersion}</code>} />
          </div>
          {result.verificationAvailable && <div className="row"><LinkButton href={`/groups/${group.id}/cycles/${cycle.id}/selection/verify`} variant="secondary" icon={<Icons.ShieldCheck size={16} />}>Verify draw</LinkButton></div>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={<span className="row" style={{ gap: 8 }}>{icon} {title}</span>} subtitle={`Cycle ${cycle.cycleNumber} · scheduled ${formatDate(cycle.selectionDate)}`} />
      <CardBody className="stack">
        {error && <Callout variant="danger">{error}</Callout>}
        {cycle.status === "SELECTION_COMPLETED" && !error ? <SkeletonText lines={2} /> : cycle.status === "READY_FOR_SELECTION" ? (
          <>
            <Callout variant="success" title="All required contributions are recorded">{reserved ? "The organizer-reserved payout right can now be recorded." : "The random draw can now be executed."}</Callout>
            {canExecute ? <div className="row"><Button loading={busy} onClick={execute} icon={reserved ? <Icons.BadgeCheck size={16} /> : <Icons.Shuffle size={16} />}>{executeLabel}</Button></div> : <WaitingState who={responsible}>{reserved ? "They record the organizer-reserved payout right." : "They execute the random draw."} No action is required from you.</WaitingState>}
          </>
        ) : cycle.status === "COLLECTING_CONTRIBUTIONS" || cycle.status === "UPCOMING" ? (
          canExecute
            ? <UnavailableAction id={`selection-${cycle.id}`} label={executeLabel} reason={pendingMembers > 0 ? `${pendingMembers} member contribution${pendingMembers === 1 ? " is" : "s are"} still ${financial ? "unpaid" : "unrecorded"}. Selection opens automatically once every contribution is complete.` : "The cycle has not reached the selection stage yet."} />
            : <WaitingState who={`${pendingMembers} remaining member${pendingMembers === 1 ? "" : "s"}`}>Selection becomes available after all required contributions for this cycle are {financial ? "paid" : "recorded"}.</WaitingState>
        ) : group.status === "SUSPENDED" ? (
          <UnavailableAction id={`selection-${cycle.id}`} label={executeLabel} reason="The group is suspended by Dhanvi. Selections are blocked until it is resumed." />
        ) : (
          <p className="text-sm text-secondary">Selection is not available in this cycle state.</p>
        )}
        {scope !== "public" && cycle.selectionMethod === "AUCTION" && <Link className="link" href={`${managePrefix(scope)}/groups/${group.id}/cycles/${cycle.id}/auction`}>View auction</Link>}
      </CardBody>
    </Card>
  );
}
