"use client";
import { useState } from "react";
import { groupService, groupPath, type GroupScope } from "@/services/group.service";
import type { Group, Member } from "@/types/group";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/dialog";
import { DescriptionList } from "@/components/ui/description";
import { Icons } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { statusLabel } from "@/lib/status";

interface Props { group: Group; members: Member[]; scope: GroupScope; canManage: boolean; mode: "applications" | "members"; onChanged: () => Promise<void>; loading?: boolean }

export function termsAccepted(member: Member, group: Group) {
  return !!member.termsAcceptedAt && member.termsVersionId === group.currentRules?.id;
}

export function GroupMembersTable({ group, members, scope, canManage, mode, onChanged, loading }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const base = `${groupPath(scope)}/${group.id}`;
  const rows = mode === "applications" ? members.filter((m) => ["APPLIED", "REJECTED"].includes(m.status)) : members.filter((m) => !["APPLIED", "REJECTED"].includes(m.status));

  async function approve(member: Member) {
    const result = await confirm({
      title: `Approve ${member.name}?`,
      description: "Approving reserves one member position for this applicant. They must then accept the group rules.",
      details: <p className="text-sm">Positions after approval: <strong>{group.currentMemberCount + 1} / {group.memberLimit}</strong></p>,
      confirmLabel: "Approve member",
    });
    if (!result.confirmed) return;
    setBusyId(member.id);
    try { await groupService.action(`${base}/applications/${member.id}/approve`); toast.success("Member approved", `${member.name} now holds a position in ${group.name}.`); await onChanged(); setSelected(null); }
    catch (failure) { toast.error("Approval failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }

  async function reject(member: Member) {
    const result = await confirm({
      title: `Reject ${member.name}'s application?`,
      description: "The applicant will see your reason. This does not affect other applications.",
      reason: { label: "Reason for rejection", placeholder: "e.g. All positions are reserved for existing circle members." },
      confirmLabel: "Reject application", variant: "danger",
    });
    if (!result.confirmed) return;
    setBusyId(member.id);
    try { await groupService.action(`${base}/applications/${member.id}/reject`, { reason: result.reason }); toast.success("Application rejected"); await onChanged(); setSelected(null); }
    catch (failure) { toast.error("Rejection failed", friendlyError(failure)); }
    finally { setBusyId(""); }
  }

  const memberCell = (m: Member) => (
    <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
      <Avatar name={m.name} size="sm" />
      <span style={{ minWidth: 0 }}>
        <span className="text-strong" style={{ display: "block" }}>{m.name}</span>
        {m.email && <span className="cell__sub">{m.email}</span>}
      </span>
    </span>
  );

  const actions = (m: Member) => (
    <span className="row" style={{ gap: 6 }}>
      <Button variant="ghost" size="sm" onClick={() => setSelected(m)}>View</Button>
      {canManage && m.status === "APPLIED" && (
        <>
          <Button size="sm" loading={busyId === m.id} disabled={group.status !== "RECRUITING" || !!busyId} onClick={() => approve(m)}>Approve</Button>
          <Button size="sm" variant="danger-outline" disabled={!!busyId} onClick={() => reject(m)}>Reject</Button>
        </>
      )}
    </span>
  );

  const applicationColumns: Column<Member>[] = [
    { key: "member", header: "Applicant", primary: true, render: memberCell },
    { key: "applied", header: "Applied", render: (m) => formatDate(m.appliedAt) },
    { key: "status", header: "Status", render: (m) => <StatusBadge kind="membership" value={m.status} /> },
    { key: "actions", header: "Actions", actions: true, render: actions },
  ];
  const memberColumns: Column<Member>[] = [
    { key: "slot", header: "Slot", render: (m) => <span className="num text-strong">{m.slotNumber ? `#${m.slotNumber}` : "—"}</span> },
    { key: "member", header: "Member", primary: true, render: memberCell },
    { key: "status", header: "Membership", render: (m) => <StatusBadge kind="membership" value={m.status} /> },
    { key: "terms", header: "Rules", render: (m) => termsAccepted(m, group) ? <Badge tone="success">Accepted</Badge> : <Badge tone="warning">Pending</Badge> },
    { key: "joined", header: "Joined", render: (m) => formatDate(m.approvedAt ?? m.appliedAt) },
    { key: "payout", header: "Payout turn", render: (m) => m.hasBeenSelectedForPayout ? <Badge tone="emerald" plain>Cycle {m.payoutCycleNumber}</Badge> : <span className="text-muted">—</span> },
    { key: "actions", header: "Actions", actions: true, render: actions },
  ];

  return (
    <>
      <DataTable columns={mode === "applications" ? applicationColumns : memberColumns} rows={loading ? undefined : rows} loading={loading} rowKey={(m) => m.id}
        caption={mode === "applications" ? "Membership applications" : "Group members"}
        empty={mode === "applications" ? { title: "No applications", description: "No membership applications are waiting for review." } : { title: "No members yet", description: "Approved applicants will appear here." }} />
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? "Member"}
        footer={selected && canManage && selected.status === "APPLIED" ? <><Button variant="danger-outline" disabled={!!busyId} onClick={() => reject(selected)}>Reject</Button><Button loading={busyId === selected.id} disabled={group.status !== "RECRUITING"} onClick={() => approve(selected)}>Approve</Button></> : undefined}>
        {selected && (
          <>
            <div className="row" style={{ gap: 12 }}><Avatar name={selected.name} size="lg" /><div><div className="text-strong">{selected.name}</div><StatusBadge kind="membership" value={selected.status} /></div></div>
            <DescriptionList stack items={[
              ...(selected.email ? [{ key: "Email", value: <a className="link" href={`mailto:${selected.email}`}>{selected.email}</a> }] : []),
              { key: "Position", value: selected.slotNumber ? `#${selected.slotNumber}` : "Not assigned" },
              { key: "Applied", value: formatDateTime(selected.appliedAt) },
              { key: "Approved", value: selected.approvedAt ? formatDateTime(selected.approvedAt) : "—" },
              { key: "Rules", value: termsAccepted(selected, group) ? `Accepted ${formatDateTime(selected.termsAcceptedAt)}` : "Not yet accepted" },
              { key: "Payout turn", value: selected.hasBeenSelectedForPayout ? `Cycle ${selected.payoutCycleNumber}` : "Not yet selected" },
              ...(selected.rejectedReason ? [{ key: "Decision reason", value: selected.rejectedReason }] : []),
            ]} />
            <p className="text-xs text-muted"><Icons.Lock size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Contact details are only shown to authorized {statusLabel("group", group.status).toLowerCase() === "active" ? "organizers" : "reviewers"}.</p>
          </>
        )}
      </Drawer>
    </>
  );
}
