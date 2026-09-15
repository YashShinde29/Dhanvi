"use client";
import { useState } from "react";
import { groupService, groupPath, type GroupScope } from "@dhanvi/api-client";
import type { Group } from "@dhanvi/types";
import { Button, Icons, RuleList, useToast, useConfirm } from "@dhanvi/ui";
import { friendlyError, formatDate, formatMoney, statusLabel } from "@dhanvi/utils";
import { UnavailableAction } from "../workflow/next-action-card";

/** Lifecycle actions for organizers/admins. Every destructive or irreversible step confirms with its consequence. */
export function GroupLifecycleActions({ group, scope, canManage, termsPending = 0, onChanged, onEdit }: { group: Group; scope: GroupScope; canManage: boolean; /** Approved members who have not accepted the current rules. */ termsPending?: number; onChanged: () => Promise<void>; onEdit: () => void }) {
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
    if (r.confirmed) await run("publish", `${base}/publish`, {}, "Group published ✓ — next: review member applications as they arrive");
  }
  async function confirmReady() {
    const r = await confirm({ title: "Confirm the group is ready to start?", description: "All positions are filled and every member has accepted the rules. Confirming moves the group to Ready to start.", confirmLabel: "Confirm ready" });
    if (r.confirmed) await run("ready", `${base}/confirm-ready`, {}, "Group is ready ✓ — next: activate it on or after the start date");
  }
  async function activate() {
    const r = await confirm({ title: `Activate ${group.name}?`, description: "Activation creates the full cycle and contribution schedule. Core group rules cannot be changed afterwards.",
      details: <RuleList items={[{ key: "Group value", value: formatMoney(group.groupValue) }, { key: "Members", value: `${group.memberLimit}` }, { key: "Monthly contribution", value: formatMoney(group.monthlyContribution) }, { key: "Cycles", value: `${group.durationMonths}` }, { key: "Start date", value: `${formatDate(group.startDate)} (${group.groupTimeZone})` }, { key: "First cycle", value: statusLabel("selection", group.firstCycleSelectionMethod) }]} />,
      confirmLabel: "Activate group" });
    if (r.confirmed) await run("activate", `groups/${group.id}/activate`, {}, "Group activated ✓ — next: members pay their cycle 1 contribution");
  }
  async function cancel() {
    const r = await confirm({ title: `Cancel ${group.name}?`, description: "Cancelling is permanent. Members will see the group as cancelled and no further applications or cycles are possible.", reason: { label: "Reason for cancellation" }, confirmLabel: "Cancel group", variant: "danger" });
    if (r.confirmed) await run("cancel", `${base}/cancel`, { reason: r.reason }, "Group cancelled — members see your reason");
  }
  async function suspend() {
    const r = await confirm({ title: `Suspend ${group.name}?`, description: "Suspension pauses contribution records, selections and bids. The schedule and history are preserved.", reason: { label: "Reason for suspension" }, confirmLabel: "Suspend group", variant: "danger" });
    if (r.confirmed) await run("suspend", `${base}/suspend`, { reason: r.reason }, "Group suspended — contributions, selections and bids are paused");
  }

  const cancellable = ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "SUSPENDED"].includes(group.status) && !group.activatedAt;
  const suspendable = scope === "admin" && ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START", "ACTIVE"].includes(group.status);

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      {!canManage && ["DRAFT", "RECRUITING", "FULLY_SUBSCRIBED", "READY_TO_START"].includes(group.status) && <span className="text-sm text-muted">Lifecycle actions are taken by this group&apos;s organizer.</span>}
      {canManage && group.status === "DRAFT" && <><Button variant="secondary" onClick={onEdit} icon={<Icons.FileText size={16} />}>Edit draft</Button><Button loading={busy === "publish"} disabled={!!busy} onClick={publish} icon={<Icons.Send size={16} />}>Publish</Button></>}
      {canManage && group.status === "FULLY_SUBSCRIBED" && (termsPending > 0
        ? <UnavailableAction id="confirm-ready" label="Confirm ready" reason={`${termsPending} approved member${termsPending === 1 ? " has" : "s have"} not accepted the current rules yet.`} />
        : <Button loading={busy === "ready"} disabled={!!busy} onClick={confirmReady} icon={<Icons.CheckCircle size={16} />}>Confirm ready</Button>)}
      {canManage && group.status === "RECRUITING" && group.availableSlots > 0 && <UnavailableAction id="confirm-ready" label="Confirm ready" reason={`${group.availableSlots} position${group.availableSlots === 1 ? " is" : "s are"} still open. Approve applications until the group is full.`} />}
      {canManage && group.status === "READY_TO_START" && <Button loading={busy === "activate"} disabled={!!busy} onClick={activate} icon={<Icons.Play size={16} />}>Activate group</Button>}
      {suspendable && <Button variant="danger-outline" loading={busy === "suspend"} disabled={!!busy} onClick={suspend} icon={<Icons.Pause size={16} />}>Suspend</Button>}
      {cancellable && <Button variant="danger-outline" loading={busy === "cancel"} disabled={!!busy} onClick={cancel} icon={<Icons.X size={16} />}>Cancel group</Button>}
    </div>
  );
}
