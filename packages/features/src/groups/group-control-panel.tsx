"use client";
import Link from "next/link";
import { useState } from "react";
import { auctionService, contributionService, groupService, groupPath, payoutService, selectionService } from "@dhanvi/api-client";
import type { Group } from "@dhanvi/types";
import { Button, ControlPanel, LinkButton, OverflowMenu, RuleList, useConfirm, useToast, type MenuAction } from "@dhanvi/ui";
import { friendlyError, formatDate, formatMoney, formatNumber, statusLabel } from "@dhanvi/utils";
import { responsibleLabel, type GroupControlState, type ControlAction, type WorkflowState } from "../workflow";

const BADGE: Record<WorkflowState, { tone: "success" | "info" | "warning" | "danger" | "neutral" | "indigo"; label: string }> = {
  complete: { tone: "success", label: "Completed" }, current: { tone: "info", label: "In progress" }, waiting: { tone: "indigo", label: "Waiting" },
  blocked: { tone: "danger", label: "Blocked" }, attention: { tone: "warning", label: "Action required" }, upcoming: { tone: "neutral", label: "Not started" },
};

interface Props {
  group: Group; scope: "admin" | "organizer"; control: GroupControlState;
  /** Current cycle id when a selection/auction/payout command applies. */
  cycleId?: string;
  /** Eligible member count for the selection confirmation (from the cycle snapshot). */
  eligibleMembers?: number;
  onChanged: () => Promise<void>;
  onEdit?: () => void;
  eyebrow?: string;
}

/**
 * Renders the derived control state with exactly one primary button. Every command confirms with its consequence and
 * reports the hand-off ("Next: …") so the operator knows who acts after them. Backend authorization remains authoritative.
 */
export function GroupControlPanel({ group: g, scope, control, cycleId, eligibleMembers, onChanged, onEdit, eyebrow }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  const base = `${groupPath(scope)}/${g.id}`;
  const viewer = scope;

  async function run(id: string, work: () => Promise<unknown>, success: [string, string]) {
    setBusy(id);
    try { await work(); toast.success(success[0], success[1]); await onChanged(); }
    catch (failure) { toast.error("Action failed", friendlyError(failure)); }
    finally { setBusy(""); }
  }
  const facts = (items: { key: string; value: string }[]) => <RuleList items={items} />;

  async function execute(action: ControlAction) {
    switch (action.id) {
      case "edit-draft": onEdit?.(); return;
      case "publish": {
        const r = await confirm({ title: `Publish ${g.name}?`, description: "Members can see the group and apply. The rules below become version 1 and members accept exactly these.", confirmLabel: "Publish group",
          details: facts([{ key: "Group value", value: formatMoney(g.groupValue) }, { key: "Monthly contribution", value: formatMoney(g.monthlyContribution) }, { key: "Members", value: `${g.memberLimit}` }, { key: "Start date", value: formatDate(g.startDate) }]) });
        if (r.confirmed) await run("publish", () => groupService.action(`${base}/publish`), ["Group published ✓", "Next: members apply. Review applications as they arrive."]);
        return;
      }
      case "confirm-ready": {
        const r = await confirm({ title: "Confirm the group is ready to start?", description: "Every position is filled and every member has accepted the rules. The group moves to Ready to start.", confirmLabel: "Confirm ready" });
        if (r.confirmed) await run("confirm-ready", () => groupService.action(`${base}/confirm-ready`), ["Group is ready ✓", `Next: activate it on or after ${formatDate(g.startDate)}.`]);
        return;
      }
      case "activate": {
        const r = await confirm({ title: `Activate ${g.name}?`, description: "Activation creates every cycle and contribution obligation. Core rules cannot change afterwards. This cannot be undone.", confirmLabel: "Activate group",
          details: facts([{ key: "Members", value: `${g.memberLimit}` }, { key: "Monthly contribution", value: formatMoney(g.monthlyContribution) }, { key: "Cycles", value: `${g.durationMonths}` }, { key: "Start date", value: `${formatDate(g.startDate)} (${g.groupTimeZone})` }, { key: "First cycle", value: statusLabel("selection", g.firstCycleSelectionMethod) }]) });
        if (r.confirmed) await run("activate", () => groupService.action(`groups/${g.id}/activate`), ["Group activated ✓", "Next: members pay their cycle 1 contribution."]);
        return;
      }
      case "start-selection":
      case "record-organizer-payout": {
        if (!cycleId) return;
        const reserved = action.id === "record-organizer-payout";
        setBusy(action.id);
        try {
          const preview = await selectionService.preview(g.id, cycleId);
          setBusy("");
          const r = await confirm(reserved
            ? { title: "Record the organizer-reserved payout right?", description: "The published rules reserve the first payout for the organizer. This records that selection; no money moves.", confirmLabel: "Record selection",
                details: facts([{ key: "Organizer", value: g.organizer?.name ?? "Organizer" }, { key: "Group value", value: formatMoney(g.groupValue) }]) }
            : { title: "Start the random selection?", description: "The draw is recorded with a seed commitment and the eligible set so it can be re-verified. The result is final and cannot be undone.", confirmLabel: "Start selection",
                details: facts([{ key: "Group", value: g.name }, { key: "Eligible members", value: formatNumber(preview.eligibleMemberCount ?? eligibleMembers ?? 0) }, { key: "Algorithm", value: preview.algorithmVersion }]) });
          if (!r.confirmed) return;
          await run(action.id, async () => { const result = await selectionService.execute(g.id, cycleId); toast.success(reserved ? "Organizer payout right recorded ✓" : "Selection completed ✓", `Member #${result.winner.slotNumber} — ${result.winner.displayName}. Next: ${scope === "admin" ? "prepare the payouts." : "Dhanvi prepares the payout."}`); }, ["Selection recorded", "Members can see the result."]);
        } catch (failure) { setBusy(""); toast.error("Selection unavailable", friendlyError(failure)); }
        return;
      }
      case "open-auction":
      case "close-auction": {
        if (!cycleId) return;
        const open = action.id === "open-auction";
        const r = await confirm(open
          ? { title: "Open the auction?", description: "Eligible members can place discount bids until it closes. The server enforces the scheduled window.", confirmLabel: "Open auction" }
          : { title: "Close and finalize the auction?", description: "The highest valid discount decides this cycle's payout right. If there are no bids the cycle stays unresolved. This cannot be undone.", confirmLabel: "Close auction", variant: "danger" });
        if (r.confirmed) await run(action.id, () => auctionService.manage(scope, g.id, cycleId, open ? "open" : "close"), open ? ["Auction opened ✓", "Next: eligible members bid until it closes."] : ["Auction closed ✓", `Next: ${scope === "admin" ? "prepare the winner's payout." : "Dhanvi prepares the winner's payout."}`]);
        return;
      }
      case "prepare-payouts": {
        if (!cycleId) return;
        const r = await confirm({ title: "Prepare this cycle's payouts?", description: "Creates the payout obligations from the recorded result and funded allocation. Approval and execution follow as separate steps.", confirmLabel: "Prepare payouts" });
        if (r.confirmed) await run("prepare-payouts", () => payoutService.prepare(cycleId), ["Payouts prepared ✓", "Next: approve each payout once its beneficiary account is available."]);
        return;
      }
      case "mark-overdue": {
        const r = await confirm({ title: "Refresh overdue status?", description: "Contributions past their due date that are not settled are marked overdue. Operational status only.", confirmLabel: "Mark overdue" });
        if (r.confirmed) await run("mark-overdue", async () => { const result = await contributionService.markOverdue(scope, g.id); toast.success(`${formatNumber(result.markedCount)} contribution${result.markedCount === 1 ? "" : "s"} marked overdue`); }, ["Overdue status refreshed", ""]);
        return;
      }
      case "suspend": {
        const r = await confirm({ title: `Suspend ${g.name}?`, description: "Pauses contribution records, selections and bids. Schedule and history are preserved. Members see the group as suspended.", reason: { label: "Reason for suspension" }, confirmLabel: "Suspend group", variant: "danger" });
        if (r.confirmed) await run("suspend", () => groupService.action(`${base}/suspend`, { reason: r.reason }), ["Group suspended", "Members see your reason. Contributions, selections and bids are paused."]);
        return;
      }
      case "cancel": {
        const r = await confirm({ title: `Cancel ${g.name}?`, description: "Cancelling is permanent. Members see the group as cancelled; no further applications or cycles are possible.", reason: { label: "Reason for cancellation" }, confirmLabel: "Cancel group", variant: "danger" });
        if (r.confirmed) await run("cancel", () => groupService.action(`${base}/cancel`, { reason: r.reason }), ["Group cancelled", "Members see your reason."]);
        return;
      }
      default: return;
    }
  }

  const primary = control.primary;
  const primaryButton = primary ? (primary.href && !["open-auction", "close-auction"].includes(primary.id)
    ? <LinkButton href={primary.href}>{primary.label}</LinkButton>
    : <Button loading={busy === primary.id} disabled={!!busy} onClick={() => execute(primary)}>{primary.label}</Button>) : undefined;
  const secondary = control.secondary.length ? control.secondary.map((a) => a.href ? <Link key={a.id} href={a.href} className="link">{a.label}</Link> : <Button key={a.id} variant="ghost" size="sm" onClick={() => execute(a)} disabled={!!busy}>{a.label}</Button>) : undefined;
  const menu: MenuAction[] = control.overflow.map((a) => ({ id: a.id, label: a.label, danger: a.danger, href: a.href, onSelect: a.href ? undefined : () => execute(a), disabled: !!busy }));
  const who = responsibleLabel(control.responsible, viewer);
  const facts_: { label: string; value: string; tone?: "blocked" | "waiting" }[] = [];
  if (control.blockedBy) facts_.push({ label: "Blocked by", value: control.blockedBy, tone: "blocked" });
  if (control.waitingOn) facts_.push({ label: "Waiting on", value: control.waitingOn, tone: "waiting" });
  if (who) facts_.push({ label: "Who acts next", value: control.primary ? "You" : who });
  if (control.next) facts_.push({ label: "Next", value: control.next });

  return (
    <ControlPanel status={control.status} eyebrow={eyebrow ?? (viewer === "admin" ? "Current situation" : "Where your group stands")} stage={control.stage} badge={BADGE[control.status]} headline={control.headline}
        facts={facts_} primary={primaryButton} secondary={secondary} menu={<OverflowMenu items={menu} label="More group actions" />}>
        {control.detail && <p className="text-sm text-secondary" style={{ margin: 0 }}>{control.detail}</p>}
        {!primaryButton && control.status !== "complete" && control.status !== "blocked" && <p className="wf-noaction" role="status" style={{ margin: 0 }}>No action is required from you right now.</p>}
      </ControlPanel>
  );
}
