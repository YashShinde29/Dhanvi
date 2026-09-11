"use client";
import { useState } from "react";
import { groupService, groupPath, type GroupScope } from "@/services/group.service";
import type { Group } from "@/types/group";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { RuleList } from "@/components/ui/description";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/status";

/** Lifecycle actions for organizers/admins. Every destructive or irreversible step confirms with its consequence. */
export function GroupLifecycleActions({ group, scope, canManage, onChanged, onEdit }: { group: Group; scope: GroupScope; canManage: boolean; onChanged: () => Promise<void>; onEdit: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  const base = `${groupPath(scope)}/${group.id}`;

  async function run(key: string, path: string, body: object, success: string) {
    setBusy(key);
    try { await groupService.action(path, body); toast.success(success); await onChanged(); }
    catch (failure) { toast.error("Action failed", friendlyError(failure)); }
    finally { setBusy(""); }
  }

  async function publish() {
    const r = await confirm({ title: `Publish ${group.name}?`, description: "Publishing makes the group visible to members and starts accepting applications. The rules snapshot below becomes version 1.",
      details: <RuleList items={[{ key: "Group value", value: formatMoney(group.groupValue) }, { key: "Monthly contribution", value: formatMoney(group.monthlyContribution) }, { key: "Members", value: `${group.memberLimit}` }, { key: "Start date", value: formatDate(group.startDate) }]} />, confirmLabel: "Publish group" });
    if (r.confirmed) await run("publish", `${base}/publish`, {}, "Group published");
  }
  async function confirmReady() {
    const r = await confirm({ title: "Confirm the group is ready to start?", description: "All positions are filled and every member has accepted the rules. Confirming moves the group to Ready to start.", confirmLabel: "Confirm ready" });
    if (r.confirmed) await run("ready", `${base}/confirm-ready`, {}, "Group marked ready to start");
  }
  async function activate() {
    const r = await confirm({ title: `Activate ${group.name}?`, description: "Activation creates the full cycle and contribution schedule. Core group rules cannot be changed afterwards.",
      details: <RuleList items={[{ key: "Group value", value: formatMoney(group.groupValue) }, { key: "Members", value: `${group.memberLimit}` }, { key: "Monthly contribution", value: formatMoney(group.monthlyContribution) }, { key: "Cycles", value: `${group.durationMonths}` }, { key: "Start date", value: `${formatDate(group.startDate)} (${group.groupTimeZone})` }, { key: "First cycle", value: statusLabel("selection", group.firstCycleSelectionMethod) }]} />,
      confirmLabel: "Activate group" });
    if (r.confirmed) await run("activate", `groups/${group.id}/activate`, {}, "Group activated");
  }
  async function cancel() {
    const r = await confirm({ title: `Cancel ${group.name}?`, description: "Cancelling is permanent. Members will see the group as cancelled and no further applications or cycles are possible.", reason: { label: "Reason for cancellation" }, confirmLabel: "Cancel group", variant: "danger" });
    if (r.confirmed) await run("cancel", `${base}/cancel`, { reason: r.reason }, "Group cancelled");
  }
  async function suspend() {
    const r = await confirm({ title: `Suspend ${group.name}?`, description: "Suspension pauses contribution records, selections and bids. The schedule and history are preserved.", reason: { label: "Reason for suspension" }, confirmLabel: "Suspend group", variant: "danger" });
    if (r.confirmed) await run("suspend", `${base}/suspend`, { reason: r.reason }, "Group suspended");
  }

  const cancellable = ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "SUSPENDED"].includes(group.status) && !group.activatedAt;
  const suspendable = scope === "admin" && ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE"].includes(group.status);

  return (
    <div className="row">
      {canManage && group.status === "DRAFT" && <><Button variant="secondary" onClick={onEdit} icon={<Icons.FileText size={16} />}>Edit draft</Button><Button loading={busy === "publish"} disabled={!!busy} onClick={publish} icon={<Icons.Send size={16} />}>Publish</Button></>}
      {canManage && group.status === "FULLY_SUBSCRIBED" && <Button loading={busy === "ready"} disabled={!!busy} onClick={confirmReady} icon={<Icons.CheckCircle size={16} />}>Confirm ready</Button>}
      {canManage && group.status === "READY_TO_START" && <Button loading={busy === "activate"} disabled={!!busy} onClick={activate} icon={<Icons.Play size={16} />}>Activate group</Button>}
      {suspendable && <Button variant="danger-outline" loading={busy === "suspend"} disabled={!!busy} onClick={suspend} icon={<Icons.Pause size={16} />}>Suspend</Button>}
      {cancellable && <Button variant="danger-outline" loading={busy === "cancel"} disabled={!!busy} onClick={cancel} icon={<Icons.X size={16} />}>Cancel group</Button>}
    </div>
  );
}
