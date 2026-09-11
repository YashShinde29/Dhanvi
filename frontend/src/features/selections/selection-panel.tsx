"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { selectionService } from "@/services/selection.service";
import type { GroupScope } from "@/services/group.service";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";
import type { SelectionResult } from "@/types/selection";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Fact, RuleList } from "@/components/ui/description";
import { Icons } from "@/components/ui/icons";
import { SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/status";

export function SelectionPanel({ group, cycle, scope, onCompleted }: { group: Group; cycle: MonthlyCycle; scope: GroupScope; onCompleted?: () => Promise<void> | void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [result, setResult] = useState<SelectionResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canExecute = group.status === "ACTIVE" && ((scope === "admin" && group.creatorType === "PLATFORM") || (scope === "organizer" && group.organizer?.status === "APPROVED"));
  const reserved = cycle.selectionMethod === "ORGANIZER_RESERVED";

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
      toast.success(reserved ? "Organizer payout right recorded" : "Random draw completed", `Member #${selected.winner.slotNumber} — ${selected.winner.displayName}`);
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
            <span className="result-hero__slot">Payout right of <strong className="amount">{formatMoney(group.groupValue)}</strong> · no money has been transferred</span>
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
            {canExecute ? <div className="row"><Button loading={busy} onClick={execute} icon={reserved ? <Icons.BadgeCheck size={16} /> : <Icons.Shuffle size={16} />}>{reserved ? "Record organizer payout" : "Execute random draw"}</Button></div> : <p className="text-sm text-secondary">Waiting for the {group.creatorType === "PLATFORM" ? "platform" : "organizer"} to run the selection.</p>}
          </>
        ) : (
          <p className="text-sm text-secondary">Selection becomes available after all required contributions for this cycle are recorded.</p>
        )}
        {scope !== "public" && cycle.selectionMethod === "AUCTION" && <Link className="link" href={`/${scope}/groups/${group.id}/cycles/${cycle.id}/auction`}>View auction</Link>}
      </CardBody>
    </Card>
  );
}
