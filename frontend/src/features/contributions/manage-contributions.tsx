"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { groupService } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import { Guard } from "@/features/groups/shared";
import type { Contribution, ContributionEntry } from "@/types/contribution";
import { useAsyncData } from "@/hooks/use-async-data";
import { CycleProgress } from "./cycle-panel";
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Fact, KeyValueRows } from "@/components/ui/description";
import { FormField, Input, MoneyInput, Textarea } from "@/components/ui/form";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Icons } from "@/components/ui/icons";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { statusLabel } from "@/lib/status";

export function ManageContributionsPage({ scope }: { scope: "admin" | "organizer" }) {
  return <Guard scope={scope}><Manage scope={scope} /></Guard>;
}

function Manage({ scope }: { scope: "admin" | "organizer" }) {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [group, cycles, contributions] = await Promise.all([groupService.details(id, scope), contributionService.cycles(id, scope), contributionService.cycleContributions(scope, id, cycleId)]);
    return { group, cycle: cycles.find((c) => c.id === cycleId), contributions };
  }, [id, cycleId, scope]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Contribution>();
  const [original, setOriginal] = useState<ContributionEntry>();
  const [history, setHistory] = useState<Contribution>();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);

  const crumbs = [{ label: scope === "organizer" ? "My groups" : "Platform groups", href: `/${scope}/groups` }, { label: data?.group.name ?? "Group", href: `/${scope}/groups/${id}` }, { label: data?.cycle ? `Cycle ${data.cycle.cycleNumber}` : "Cycle", href: `/${scope}/groups/${id}` }, { label: "Contributions" }];
  if (error) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data) return <PageSkeleton />;
  const { group, cycle, contributions } = data;
  if (!cycle) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message="We couldn't find this cycle." /></div>;

  const owner = scope === "organizer" || group.creatorType === "PLATFORM";
  const operational = owner && group.status === "ACTIVE";
  const canRecord = operational && cycle.status === "COLLECTING_CONTRIBUTIONS";
  const canReverse = operational && ["COLLECTING_CONTRIBUTIONS", "CONTRIBUTIONS_COMPLETE", "READY_FOR_SELECTION"].includes(cycle.status);

  function open(contribution: Contribution, entry?: ContributionEntry) {
    setSelected(contribution); setOriginal(entry);
    setAmount(String(contribution.expectedAmount - contribution.recordedAmount)); setReference(""); setNote(""); setFormError("");
    pending.current = null;
  }

  async function markOverdue() {
    const decision = await confirm({ title: "Refresh overdue status?", description: "Contributions past their due date that are not fully recorded will be marked overdue. This is an operational status only.", confirmLabel: "Mark overdue" });
    if (!decision.confirmed) return;
    setBusy(true);
    try { const result = await contributionService.markOverdue(scope, id); await reload(); toast.success(`${formatNumber(result.markedCount)} contribution${result.markedCount === 1 ? "" : "s"} marked overdue`); }
    catch (e) { toast.error("Couldn't update overdue status", friendlyError(e)); }
    finally { setBusy(false); }
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
      ? { title: `Reverse ${formatMoney(original.amount)} for ${selected.memberName}?`, description: "The original record is preserved as history and a reversal entry is added. The cycle may return to collecting contributions.", confirmLabel: "Confirm reversal", variant: "danger" }
      : { title: `Record ${formatMoney(Number(amount))} for ${selected.memberName}?`, description: "This records an operational contribution. It does not process a real payment.", details: <KeyValueRows items={[{ key: "Reference", value: reference.trim() }, { key: "Cycle", value: `${cycle?.cycleNumber ?? ""}` }]} />, confirmLabel: "Confirm manual record" });
    if (!decision.confirmed) return;
    const body = original ? { entryId: original.id, reason: note.trim() } : { amount: Number(amount), reference: reference.trim(), note: note.trim() };
    const path = `${scope}/groups/${id}/cycles/${cycleId}/contributions/${selected.id}/${original ? "reverse" : "record"}`;
    const signature = JSON.stringify({ path, body });
    // Preserve the idempotency key across retries of the same operation.
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    try {
      await contributionService.operate(path, pending.current.key, body);
      await reload();
      setSelected(undefined); pending.current = null;
      toast.success(original ? "Reversal recorded" : "Contribution recorded", original ? "The original entry is preserved in history." : "No payment was processed.");
    } catch (e) { setFormError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const columns: Column<Contribution>[] = [
    { key: "member", header: "Member", primary: true, render: (c) => <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar name={c.memberName} size="sm" /><span><span className="text-strong" style={{ display: "block" }}>{c.memberName ?? "Member"}</span><span className="cell__sub">Slot #{c.slotNumber ?? "—"}</span></span></span> },
    { key: "expected", header: "Expected", align: "right", render: (c) => <span className="amount">{formatMoney(c.expectedAmount)}</span> },
    { key: "recorded", header: "Recorded", align: "right", render: (c) => <span className="amount" style={{ fontWeight: 500 }}>{formatMoney(c.recordedAmount)}</span> },
    { key: "status", header: "Status", render: (c) => <StatusBadge kind="contribution" value={c.status} /> },
    { key: "due", header: "Due / recorded", render: (c) => <>{formatDate(c.dueDate)}<span className="cell__sub">{c.recordedAt ? `Recorded ${formatDateTime(c.recordedAt, c.groupTimeZone)}` : "Not recorded"}</span></> },
    { key: "actions", header: "Actions", actions: true, render: (c) => (
      <span className="row" style={{ gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => setHistory(c)} icon={<Icons.History size={14} />}>History{c.entries.length ? ` (${c.entries.length})` : ""}</Button>
        {canRecord && c.recordedAmount < c.expectedAmount && <Button size="sm" variant="secondary" disabled={busy} onClick={() => open(c)}>Manual record</Button>}
      </span>
    ) },
  ];

  const remaining = selected ? selected.expectedAmount - selected.recordedAmount : 0;

  return (
    <div className="stack stack--lg">
      <PageHeader breadcrumbs={crumbs} eyebrow={statusLabel("cycle", cycle.status)} title={`Cycle ${cycle.cycleNumber} contributions`} description={`${group.name} · ${statusLabel("selection", cycle.selectionMethod)} · dates in ${cycle.groupTimeZone}`}
        badges={<StatusBadge kind="cycle" value={cycle.status} />}
        actions={operational && <Button variant="secondary" loading={busy} onClick={markOverdue} icon={<Icons.Refresh size={16} />}>Refresh overdue status</Button>} />
      <Callout variant="warning" title="Manual records only">Recording a contribution here is an operational record. It does not process a real payment or confirm money movement.</Callout>
      <Card>
        <CardHeader title="Collection progress" subtitle={`Due ${formatDate(cycle.contributionDueDate)} · ${cycle.selectionMethod === "AUCTION" ? "auction" : "selection"} ${formatDate(cycle.selectionDate)}`} />
        <CardBody className="stack">
          <div className="grid-4">
            <Fact label="Members complete" value={<span className="num">{cycle.fullyRecordedMemberCount} / {cycle.expectedMemberCount}</span>} large />
            <Fact label="Recorded" value={formatMoney(cycle.recordedContributionAmount)} large />
            <Fact label="Expected pool" value={formatMoney(cycle.expectedPoolAmount)} large />
            <Fact label="Pending" value={<span className="num">{cycle.pendingMemberCount} member{cycle.pendingMemberCount === 1 ? "" : "s"}</span>} large />
          </div>
          <CycleProgress cycle={cycle} />
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={contributions} rowKey={(c) => c.id} caption="Member contributions for this cycle" empty={{ title: "No contribution obligations", description: "Obligations are created when the group is activated." }} />

      <Dialog open={!!selected} onClose={() => !busy && setSelected(undefined)} title={original ? "Reverse manual record" : "Manual record"} description={selected ? `${selected.memberName} · Cycle ${cycle.cycleNumber}` : undefined}>
        {selected && (
          <form className="stack" onSubmit={submit} noValidate>
            <Callout variant="neutral">{original ? "The original record stays in history. A reversal entry is added." : "This records an operational contribution. It does not process a real payment."}</Callout>
            {!original && (
              <>
                <div className="grid-2"><Fact label="Expected" value={formatMoney(selected.expectedAmount)} /><Fact label="Remaining" value={formatMoney(remaining)} /></div>
                <FormField label="Amount" htmlFor="record-amount" required help={`Up to ${formatMoney(remaining)}.`}>
                  <MoneyInput id="record-amount" value={amount} onChange={setAmount} disabled={busy} autoFocus />
                </FormField>
                <FormField label="Manual reference" htmlFor="record-reference" required help="Operational reference only — never bank details or payment credentials.">
                  <Input id="record-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} disabled={busy} />
                </FormField>
              </>
            )}
            {original && <KeyValueRows items={[{ key: "Original record", value: formatMoney(original.amount) }, { key: "Reference", value: original.reference }, { key: "Recorded", value: formatDateTime(original.createdAt, selected.groupTimeZone) }]} />}
            <FormField label={original ? "Reason for reversal" : "Note"} htmlFor="record-note" required={!!original} optional={!original}>
              <Textarea id="record-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} disabled={busy} autoFocus={!!original} />
            </FormField>
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
            {history.entries.length === 0 && <p className="text-sm text-muted">No manual operations recorded yet.</p>}
            {history.entries.map((entry) => {
              const reversed = history.entries.some((e) => e.reversesEntryId === entry.id);
              return (
                <Card key={entry.id} muted>
                  <CardBody className="stack stack--sm" style={{ padding: 14 }}>
                    <div className="row row--between">
                      <span className="row" style={{ gap: 8 }}><Badge tone={entry.entryType === "RECORD" ? "success" : "orange"}>{entry.entryType === "RECORD" ? "Record" : "Reversal"}</Badge><span className="amount">{formatMoney(entry.amount)}</span></span>
                      <span className="text-xs text-muted">{formatDateTime(entry.createdAt, history.groupTimeZone)}</span>
                    </div>
                    <div className="text-sm"><span className="text-muted">Reference:</span> {entry.reference}</div>
                    {entry.note && <div className="text-sm text-secondary">{entry.note}</div>}
                    {entry.reversesEntryId && <div className="text-xs text-muted">Reverses record <code className="mono">{entry.reversesEntryId}</code></div>}
                    {reversed && <Badge tone="neutral" plain>Reversed</Badge>}
                    {canReverse && entry.entryType === "RECORD" && !reversed && <div><Button size="sm" variant="danger-outline" disabled={busy} onClick={() => { setHistory(undefined); open(history, entry); }} icon={<Icons.Undo size={14} />}>Reverse record</Button></div>}
                  </CardBody>
                </Card>
              );
            })}
            <Link className="link text-sm" href={`/${scope}/groups/${id}`}>Back to group</Link>
          </>
        )}
      </Drawer>
    </div>
  );
}
