"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { groupService, contributionService } from "@dhanvi/api-client";
import { Guard, managePrefix } from "../groups/shared";
import type { Contribution, ContributionEntry, Group, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, friendlyError, formatDate, formatDateTime, formatMoney, humanize, statusLabel } from "@dhanvi/utils";
import { Breadcrumbs, PageHeader, Button, Callout, ErrorState, Card, CardBody, KeyValueRows, DataTable, type Column, Dialog, Drawer, FormField, Input, MoneyInput, Textarea, StatusBadge, Badge, Avatar, Icons, PageSkeleton, OverflowMenu, useToast, useConfirm } from "@dhanvi/ui";
import { CycleProgress } from "./cycle-progress";

export function ManageContributionsPage({ scope }: { scope: "admin" | "organizer" }) {
  return <Guard scope={scope}><Manage scope={scope} /></Guard>;
}

function Manage({ scope }: { scope: "admin" | "organizer" }) {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [group, cycles, contributions] = await Promise.all([groupService.details(id, scope), contributionService.cycles(id, scope), contributionService.cycleContributions(scope, id, cycleId)]);
    return { group, cycle: cycles.find((c) => c.id === cycleId), contributions };
  }, [id, cycleId, scope]);
  const crumbs = [{ label: scope === "organizer" ? "My groups" : "Groups", href: `${managePrefix(scope)}/groups` }, { label: data?.group.name ?? "Group", href: `${managePrefix(scope)}/groups/${id}?tab=cycles` }, { label: data?.cycle ? `Cycle ${data.cycle.cycleNumber} contributions` : "Contributions" }];
  if (error) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data) return <PageSkeleton />;
  const { group, cycle, contributions } = data;
  if (!cycle) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message="We couldn't find this cycle." /></div>;
  const financial = cycle.collectionMode === "RAZORPAY";
  const settled = financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount;
  return (
    <div className="stack stack--lg">
      <PageHeader breadcrumbs={crumbs} eyebrow={group.name} title={`Cycle ${cycle.cycleNumber} contributions`}
        description={`${settled} of ${cycle.expectedMemberCount} ${financial ? "settled through Razorpay" : "recorded"} · due ${formatDate(cycle.contributionDueDate)} · ${statusLabel("selection", cycle.selectionMethod)} on ${formatDate(cycle.selectionDate)}`}
        badges={<StatusBadge kind="cycle" value={cycle.status} />} />
      <Card><CardBody><CycleProgress cycle={cycle} /></CardBody></Card>
      <CycleContributionsTable group={group} cycle={cycle} contributions={contributions} scope={scope} onChanged={reload} />
      <p className="text-xs text-muted"><Link className="link" href={`${managePrefix(scope)}/groups/${id}?tab=cycles`}>Back to the group&apos;s cycles</Link></p>
    </div>
  );
}

/**
 * Operational contribution table. Keeps "manual recorded" and "gateway settled" as separate columns so operators never
 * confuse a tracked record with real money. Manual recording is offered only where the backend allows it
 * (manual-tracking group, collecting cycle, operator of the group).
 */
export function CycleContributionsTable({ group, cycle, contributions, scope, onChanged, compact }: { group: Group; cycle: MonthlyCycle; contributions: Contribution[]; scope: "admin" | "organizer"; onChanged: () => Promise<void>; compact?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Contribution>();
  const [original, setOriginal] = useState<ContributionEntry>();
  const [history, setHistory] = useState<Contribution>();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const financial = cycle.collectionMode === "RAZORPAY";
  const owner = scope === "organizer" || group.creatorType === "PLATFORM";
  const operational = owner && group.status === "ACTIVE" && !financial;
  const canRecord = operational && cycle.status === "COLLECTING_CONTRIBUTIONS";
  const canReverse = operational && ["COLLECTING_CONTRIBUTIONS", "CONTRIBUTIONS_COMPLETE", "READY_FOR_SELECTION"].includes(cycle.status);

  function open(contribution: Contribution, entry?: ContributionEntry) {
    setSelected(contribution); setOriginal(entry);
    setAmount(String(contribution.expectedAmount - contribution.recordedAmount)); setReference(""); setNote(""); setFormError("");
    pending.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setFormError("");
    const remaining = selected.expectedAmount - selected.recordedAmount;
    if (!original) {
      const value = Number(amount);
      if (!(value > 0)) { setFormError("Enter the amount to record."); return; }
      if (value > remaining + 1e-9) { setFormError(`You can record at most ${formatMoney(remaining)} for this member.`); return; }
      if (!reference.trim()) { setFormError("Enter an operational reference."); return; }
    } else if (!note.trim()) { setFormError("Enter the reason for the reversal."); return; }
    const decision = await confirm(original
      ? { title: `Reverse ${formatMoney(original.amount)} for ${selected.memberName}?`, description: "The original record stays in history and a reversal entry is added. The cycle may return to collecting.", confirmLabel: "Confirm reversal", variant: "danger" }
      : { title: `Record ${formatMoney(Number(amount))} for ${selected.memberName}?`, description: "An operational record only — it does not process or confirm a real payment.", details: <KeyValueRows items={[{ key: "Reference", value: reference.trim() }, { key: "Cycle", value: `${cycle.cycleNumber}` }]} />, confirmLabel: "Confirm manual record" });
    if (!decision.confirmed) return;
    const body = original ? { entryId: original.id, reason: note.trim() } : { amount: Number(amount), reference: reference.trim(), note: note.trim() };
    const path = `${scope}/groups/${group.id}/cycles/${cycle.id}/contributions/${selected.id}/${original ? "reverse" : "record"}`;
    const signature = JSON.stringify({ path, body });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    try {
      await contributionService.operate(path, pending.current.key, body);
      await onChanged();
      setSelected(undefined); pending.current = null;
      toast.success(original ? "Reversal recorded" : "Contribution recorded", original ? "The original entry is preserved in history." : "No payment was processed.");
    } catch (e) { setFormError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const paymentStatus = (c: Contribution) => {
    if (!financial) return <span className="text-muted">Manual tracking</span>;
    const s = c.financialStatus.toUpperCase();
    return <Badge tone={s === "SETTLED" ? "success" : s === "REFUNDED" ? "orange" : "neutral"}>{s === "SETTLED" ? "Gateway settled" : s === "REFUNDED" ? "Refunded" : "Unpaid"}</Badge>;
  };
  const columns: Column<Contribution>[] = [
    { key: "member", header: "Member", primary: true, render: (c) => <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar name={c.memberName} size="sm" /><span><span className="text-strong" style={{ display: "block" }}>{c.memberName ?? "Member"}</span><span className="cell__sub">Slot #{c.slotNumber ?? "—"}</span></span></span> },
    { key: "expected", header: "Expected", align: "right", render: (c) => <span className="amount">{formatMoney(c.expectedAmount)}</span> },
    { key: "recorded", header: "Manual recorded", align: "right", render: (c) => <span className={`amount${financial ? " text-muted" : ""}`}>{formatMoney(c.recordedAmount)}</span> },
    { key: "settled", header: "Gateway settled", align: "right", render: (c) => <span className={`amount${financial ? "" : " text-muted"}`}>{financial ? formatMoney(c.financiallySettledAmount) : "—"}</span> },
    { key: "payment", header: "Payment status", render: paymentStatus },
    { key: "due", header: "Due", render: (c) => <>{formatDate(c.dueDate)}{c.recordedAt && <span className="cell__sub">Recorded {formatDateTime(c.recordedAt, c.groupTimeZone)}</span>}</> },
    { key: "status", header: "Status", render: (c) => <StatusBadge kind="contribution" value={c.status} /> },
    { key: "actions", header: "", actions: true, render: (c) => (
      <span className="row" style={{ gap: 6 }}>
        {canRecord && c.recordedAmount < c.expectedAmount ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => open(c)}>Record</Button> : null}
        <OverflowMenu size="sm" label={`More for ${c.memberName ?? "member"}`} items={[{ id: "history", label: `History${c.entries.length ? ` (${c.entries.length})` : ""}`, onSelect: () => setHistory(c), icon: <Icons.History size={14} /> }]} />
      </span>
    ) },
  ];
  const remaining = selected ? selected.expectedAmount - selected.recordedAmount : 0;
  return (
    <>
      {operational && !compact && <Callout variant="neutral">Manual records track reported contributions. They never process or confirm money movement.</Callout>}
      <DataTable columns={columns} rows={contributions} rowKey={(c) => c.id} caption="Member contributions for this cycle" compact={compact} empty={{ title: "No contribution obligations", description: "Obligations are created when the group is activated." }} />
      <Dialog open={!!selected} onClose={() => !busy && setSelected(undefined)} title={original ? "Reverse manual record" : "Manual record"} description={selected ? `${selected.memberName} · Cycle ${cycle.cycleNumber}` : undefined}>
        {selected && (
          <form className="stack" onSubmit={submit} noValidate>
            <Callout variant="neutral">{original ? "The original record stays in history. A reversal entry is added." : "An operational record. It does not process a real payment."}</Callout>
            {!original && (
              <>
                <div className="grid-2"><KeyValueRows items={[{ key: "Expected", value: formatMoney(selected.expectedAmount) }, { key: "Remaining", value: formatMoney(remaining) }]} /></div>
                <FormField label="Amount" htmlFor="record-amount" required help={`Up to ${formatMoney(remaining)}.`}><MoneyInput id="record-amount" value={amount} onChange={setAmount} disabled={busy} autoFocus /></FormField>
                <FormField label="Manual reference" htmlFor="record-reference" required help="Operational reference only — never bank details or payment credentials."><Input id="record-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} disabled={busy} /></FormField>
              </>
            )}
            {original && <KeyValueRows items={[{ key: "Original record", value: formatMoney(original.amount) }, { key: "Reference", value: original.reference }, { key: "Recorded", value: formatDateTime(original.createdAt, selected.groupTimeZone) }]} />}
            <FormField label={original ? "Reason for reversal" : "Note"} htmlFor="record-note" required={!!original} optional={!original}><Textarea id="record-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} disabled={busy} autoFocus={!!original} /></FormField>
            {formError && <Callout variant="danger">{formError}</Callout>}
            <div className="dialog__footer" style={{ padding: 0 }}>
              <Button variant="secondary" onClick={() => setSelected(undefined)} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy} variant={original ? "danger" : "primary"}>{original ? "Confirm reversal" : "Confirm manual record"}</Button>
            </div>
          </form>
        )}
      </Dialog>
      <Drawer open={!!history} onClose={() => setHistory(undefined)} title={history ? `${history.memberName} · history` : "History"}>
        {history && (
          <>
            <div className="row row--between"><StatusBadge kind="contribution" value={history.status} /><span className="amount">{formatMoney(history.recordedAmount)} / {formatMoney(history.expectedAmount)}</span></div>
            {financial && <p className="text-sm text-secondary">Gateway settled: <strong className="amount">{formatMoney(history.financiallySettledAmount)}</strong> · {humanize(history.financialStatus)}</p>}
            {history.entries.length === 0 && <p className="text-sm text-muted">No manual operations recorded.</p>}
            {history.entries.map((entry) => {
              const reversed = history.entries.some((e) => e.reversesEntryId === entry.id);
              return (
                <Card key={entry.id} muted>
                  <CardBody className="stack stack--sm" style={{ padding: 14 }}>
                    <div className="row row--between"><span className="row" style={{ gap: 8 }}><Badge tone={entry.entryType === "RECORD" ? "success" : "orange"}>{entry.entryType === "RECORD" ? "Record" : "Reversal"}</Badge><span className="amount">{formatMoney(entry.amount)}</span></span><span className="text-xs text-muted">{formatDateTime(entry.createdAt, history.groupTimeZone)}</span></div>
                    <div className="text-sm"><span className="text-muted">Reference:</span> {entry.reference}</div>
                    {entry.note && <div className="text-sm text-secondary">{entry.note}</div>}
                    {reversed && <Badge tone="neutral" plain>Reversed</Badge>}
                    {canReverse && entry.entryType === "RECORD" && !reversed && <div><Button size="sm" variant="danger-outline" disabled={busy} onClick={() => { setHistory(undefined); open(history, entry); }} icon={<Icons.Undo size={14} />}>Reverse record</Button></div>}
                  </CardBody>
                </Card>
              );
            })}
          </>
        )}
      </Drawer>
    </>
  );
}
