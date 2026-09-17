"use client";
import { useState } from "react";
import { groupService, groupPath, type GroupScope } from "@dhanvi/api-client";
import type { Contribution, Group, Member } from "@dhanvi/types";
import { Avatar, Badge, StatusBadge, Button, DataTable, type Column, Drawer, DescriptionList, useToast, useConfirm } from "@dhanvi/ui";
import { friendlyError, formatDate, formatDateTime, formatMoney, humanize } from "@dhanvi/utils";

interface Props {
  group: Group; members: Member[]; scope: GroupScope; canManage: boolean; mode: "applications" | "members"; onChanged: () => Promise<void>; loading?: boolean;
  /** Admin/organizer operational context: the current cycle's contribution per membership id and payout state per membership id. */
  contributions?: Map<string, Contribution>; payoutStatus?: Map<string, string>;
  /** "operational" adds contribution / payout columns and the how-this-member-affects-the-group drawer. */
  presentation?: "operational" | "standard";
}

export function termsAccepted(member: Member, group: Group) {
  return !!member.termsAcceptedAt && member.termsVersionId === group.currentRules?.id;
}

/**
 * Applications: one contextual action per row ("Review") opening the decision drawer, where Approve / Reject live once.
 * Members: "View" opens the operational drawer. No inline approve/reject duplicates.
 */
export function GroupMembersTable({ group, members, scope, canManage, mode, onChanged, loading, contributions, payoutStatus, presentation = "standard" }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const base = `${groupPath(scope)}/${group.id}`;
  const rows = mode === "applications" ? members.filter((m) => ["APPLIED", "REJECTED"].includes(m.status)) : members.filter((m) => !["APPLIED", "REJECTED"].includes(m.status));
  const reviewable = canManage && group.status === "RECRUITING";

  async function approve(member: Member) {
    const result = await confirm({ title: `Approve ${member.name}?`, description: "Approving reserves one member position. The member must then accept the group rules before the group can start.",
      details: <p className="text-sm">Positions after approval: <strong>{group.currentMemberCount + 1} / {group.memberLimit}</strong></p>, confirmLabel: "Approve member" });
    if (!result.confirmed) return;
    setBusyId(member.id);
    try { await groupService.action(`${base}/applications/${member.id}/approve`); toast.success("Membership approved ✓", `Next: ${member.name} must accept the group rules. Waiting on: ${member.name}.`); await onChanged(); setSelected(null); }
    catch (failure) { toast.error("Approval failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }
  async function reject(member: Member) {
    const result = await confirm({ title: `Reject ${member.name}'s application?`, description: "The applicant sees your reason. Other applications are unaffected.", reason: { label: "Reason for rejection", placeholder: "e.g. All positions are reserved for existing circle members." }, confirmLabel: "Reject application", variant: "danger" });
    if (!result.confirmed) return;
    setBusyId(member.id);
    try { await groupService.action(`${base}/applications/${member.id}/reject`, { reason: result.reason }); toast.success("Application rejected", "The applicant sees your reason. The position stays open."); await onChanged(); setSelected(null); }
    catch (failure) { toast.error("Rejection failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }

  const memberCell = (m: Member) => (
    <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
      <Avatar name={m.name} size="sm" />
      <span style={{ minWidth: 0 }}><span className="text-strong" style={{ display: "block" }}>{m.name}</span>{m.email && <span className="cell__sub">{m.email}</span>}</span>
    </span>
  );
  const contributionCell = (m: Member) => {
    const c = contributions?.get(m.id);
    if (!c) return <span className="text-muted">—</span>;
    const financial = c.collectionMode === "RAZORPAY";
    const settled = financial ? c.financialStatus.toUpperCase() === "SETTLED" : c.status === "RECORDED";
    return <span className="cell-tight"><Badge tone={settled ? "success" : c.status === "OVERDUE" ? "danger" : "warning"}>{settled ? (financial ? "Settled" : "Recorded") : c.status === "OVERDUE" ? "Overdue" : "Outstanding"}</Badge><span className="cell__sub">{formatMoney(financial ? c.financiallySettledAmount : c.recordedAmount)} of {formatMoney(c.expectedAmount)}</span></span>;
  };
  const eligibility = (m: Member) => m.status !== "ACTIVE" ? "Not active" : m.hasBeenSelectedForPayout ? `Received cycle ${m.payoutCycleNumber}` : "Eligible";

  const applicationColumns: Column<Member>[] = [
    { key: "member", header: "Applicant", primary: true, render: memberCell },
    { key: "applied", header: "Applied", render: (m) => formatDate(m.appliedAt) },
    { key: "status", header: "Status", render: (m) => <span className="cell-tight"><StatusBadge kind="membership" value={m.status} />{m.rejectedReason && <span className="cell__sub">{m.rejectedReason}</span>}</span> },
    { key: "actions", header: "", actions: true, render: (m) => <Button variant={m.status === "APPLIED" && reviewable ? "secondary" : "ghost"} size="sm" onClick={() => setSelected(m)}>{m.status === "APPLIED" && reviewable ? "Review" : "View"}</Button> },
  ];
  const memberColumns: Column<Member>[] = [
    { key: "slot", header: "Slot", render: (m) => <span className="num text-strong">{m.slotNumber ? `#${m.slotNumber}` : "—"}</span> },
    { key: "member", header: "Member", primary: true, render: memberCell },
    { key: "status", header: "Membership", render: (m) => <StatusBadge kind="membership" value={m.status} /> },
    { key: "terms", header: "Rules", render: (m) => termsAccepted(m, group) ? <Badge tone="success" plain>Accepted</Badge> : <Badge tone="warning">Pending</Badge> },
    ...(presentation === "operational" && contributions ? [{ key: "contribution", header: "This cycle", render: contributionCell }] : []),
    ...(presentation === "operational" ? [{ key: "eligible", header: "Selection", render: (m: Member) => <span className={m.hasBeenSelectedForPayout ? "text-muted" : undefined}>{eligibility(m)}</span> }] : [{ key: "joined", header: "Joined", render: (m: Member) => formatDate(m.approvedAt ?? m.appliedAt) }]),
    { key: "payout", header: "Payout", render: (m) => { const p = payoutStatus?.get(m.id); return p ? <Badge tone={p === "SUCCEEDED" ? "success" : ["FAILED", "RECONCILIATION_REQUIRED"].includes(p) ? "danger" : "neutral"}>{humanize(p)}</Badge> : m.hasBeenSelectedForPayout ? <Badge tone="emerald" plain>Cycle {m.payoutCycleNumber}</Badge> : <span className="text-muted">—</span>; } },
    { key: "actions", header: "", actions: true, render: (m) => <Button variant="ghost" size="sm" onClick={() => setSelected(m)}>View</Button> },
  ];

  const own = selected ? contributions?.get(selected.id) : undefined;
  return (
    <>
      <DataTable columns={mode === "applications" ? applicationColumns : memberColumns} rows={loading ? undefined : rows} loading={loading} rowKey={(m) => m.id}
        caption={mode === "applications" ? "Membership applications" : "Group members"}
        empty={mode === "applications" ? { title: "No applications", description: "No membership applications are waiting for review." } : { title: "No members yet", description: "Approved applicants appear here." }} />
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? "Member"}
        footer={selected && reviewable && selected.status === "APPLIED" ? <><Button variant="danger-outline" disabled={!!busyId} onClick={() => reject(selected)}>Reject</Button><Button loading={busyId === selected.id} disabled={!!busyId} onClick={() => approve(selected)}>Approve membership</Button></> : undefined}>
        {selected && (
          <>
            <div className="row" style={{ gap: 12 }}><Avatar name={selected.name} size="lg" /><div><div className="text-strong">{selected.name}</div><StatusBadge kind="membership" value={selected.status} /></div></div>
            {selected.status === "APPLIED" && canManage && group.status !== "RECRUITING" && <p className="text-sm text-muted">Applications can only be approved while the group is recruiting.</p>}
            <DescriptionList stack items={[
              ...(selected.email ? [{ key: "Email", value: <a className="link" href={`mailto:${selected.email}`}>{selected.email}</a> }] : []),
              { key: "Membership", value: humanize(selected.status) },
              { key: "Slot", value: selected.slotNumber ? `#${selected.slotNumber}` : "Not assigned" },
              { key: "Applied", value: formatDateTime(selected.appliedAt) },
              { key: "Joined", value: selected.approvedAt ? formatDateTime(selected.approvedAt) : "—" },
              { key: "Rules accepted", value: termsAccepted(selected, group) ? formatDateTime(selected.termsAcceptedAt) : "Not yet" },
              ...(presentation === "operational" ? [
                { key: "Contribution (this cycle)", value: own ? `${formatMoney(own.collectionMode === "RAZORPAY" ? own.financiallySettledAmount : own.recordedAmount)} of ${formatMoney(own.expectedAmount)} · ${own.collectionMode === "RAZORPAY" ? humanize(own.financialStatus) : humanize(own.status)}` : "—" },
                { key: "Selection eligibility", value: eligibility(selected) },
                { key: "Payout", value: payoutStatus?.get(selected.id) ? humanize(payoutStatus.get(selected.id)) : selected.hasBeenSelectedForPayout ? `Payout right · cycle ${selected.payoutCycleNumber}` : "Not selected yet" },
              ] : [{ key: "Payout turn", value: selected.hasBeenSelectedForPayout ? `Cycle ${selected.payoutCycleNumber}` : "Not yet selected" }]),
              ...(selected.rejectedReason ? [{ key: "Decision reason", value: selected.rejectedReason }] : []),
            ]} />
          </>
        )}
      </Drawer>
    </>
  );
}
