"use client";
import Link from "next/link";
import { managePrefix } from "../groups/shared";
import type { GroupScope } from "@dhanvi/api-client";
import type { Group, Contribution, MonthlyCycle } from "@dhanvi/types";
import { formatDate, formatMoney, formatNumber, statusLabel } from "@dhanvi/utils";
import { StatusBadge, ProgressBar, DataTable, type Column } from "@dhanvi/ui";

export function CycleProgress({ cycle }: { cycle: MonthlyCycle }) {
  const financial = cycle.collectionMode === "RAZORPAY";
  const amount = financial ? cycle.financiallySettledAmount : cycle.recordedContributionAmount;
  const members = financial ? cycle.financiallySettledMemberCount : cycle.fullyRecordedMemberCount;
  return (
    <ProgressBar value={amount} max={cycle.expectedPoolAmount} label={`Cycle ${cycle.cycleNumber} contributions ${financial ? "gateway settled" : "recorded"}`}
      start={<><strong className="num">{members} / {cycle.expectedMemberCount}</strong> members complete · {formatNumber(cycle.expectedMemberCount - members)} pending</>}
      end={<span className="amount" style={{ fontWeight: 500 }}>{formatMoney(amount)} / {formatMoney(cycle.expectedPoolAmount)}</span>} />
  );
}

/** Schedule table shared by member and organizer views. Operators get a link into each cycle's contributions. */
export function CycleScheduleTable({ group, cycles, scope, mine = [] }: { group: Group; cycles: MonthlyCycle[]; scope: GroupScope; mine?: Contribution[] }) {
  const management = scope === "organizer" || scope === "admin";
  const columns: Column<MonthlyCycle>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (c) => <span className="text-strong">Cycle {c.cycleNumber}{c.cycleNumber === group.currentCycleNumber ? <span className="badge badge--success badge--plain" style={{ marginLeft: 8 }}>Current</span> : null}</span> },
    { key: "due", header: "Contribution due", render: (c) => formatDate(c.contributionDueDate) },
    { key: "selection", header: "Selection", render: (c) => <>{formatDate(c.selectionDate)}<span className="cell__sub">{statusLabel("selection", c.selectionMethod)}</span></> },
    { key: "payout", header: "Payout date", render: (c) => formatDate(c.payoutDate) },
    { key: "status", header: "Status", render: (c) => <StatusBadge kind="cycle" value={c.status} /> },
    management
      ? { key: "settled", header: "Settled", align: "right", render: (c) => <Link className="link num" href={`${managePrefix(scope)}/groups/${group.id}/cycles/${c.id}/contributions`}>{c.collectionMode === "RAZORPAY" ? c.financiallySettledMemberCount : c.fullyRecordedMemberCount} / {c.expectedMemberCount}</Link> }
      : { key: "mine", header: "My contribution", render: (c) => { const record = mine.find((m) => m.cycleId === c.id); return record ? <StatusBadge kind="contribution" value={record.status} /> : <span className="text-muted">—</span>; } },
  ];
  return <DataTable columns={columns} rows={cycles} rowKey={(c) => c.id} caption="Monthly cycle schedule" empty={{ title: "No cycles scheduled yet" }} />;
}
