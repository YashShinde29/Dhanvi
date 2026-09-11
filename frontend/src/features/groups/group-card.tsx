import Link from "next/link";
import { CreatorTypeBadge, GroupTypeBadge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/description";
import { Icons } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatDate, formatMoney } from "@/lib/format";
import type { Group } from "@/types/group";

export function GroupCard({ group, href, manage }: { group: Group; href: string; manage?: boolean }) {
  const joined = group.currentMemberCount;
  const full = joined >= group.memberLimit;
  return (
    <Card interactive className="group-card">
      <div className="group-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="group-card__badges"><GroupTypeBadge type={group.groupType} /><StatusBadge kind="group" value={group.status} /></div>
          <h3 className="group-card__name" style={{ marginTop: 10 }}><Link href={href}>{group.name}</Link></h3>
          <div className="group-card__creator">Created by {group.creatorType === "PLATFORM" ? "Dhanvi" : group.organizer?.name ?? "Organizer"}{group.organizer?.verified && group.creatorType === "ORGANIZER" ? " · Verified organizer" : ""}</div>
        </div>
      </div>
      <div className="group-card__facts">
        <Fact label="Group value" value={formatMoney(group.groupValue)} large />
        <Fact label="Monthly contribution" value={formatMoney(group.monthlyContribution)} large />
        <Fact label="Members" value={`${joined} / ${group.memberLimit}`} />
        <Fact label="Duration" value={`${group.durationMonths} months`} />
      </div>
      <ProgressBar value={joined} max={group.memberLimit} label={`${joined} of ${group.memberLimit} members joined`} size="sm"
        start={full ? "Fully subscribed" : `${joined} of ${group.memberLimit} joined`} end={full ? undefined : `${group.availableSlots} left`} tone={full ? "indigo" : undefined} />
      {group.organizerFirstPayout && <span className="group-card__note"><Icons.Info size={14} /> Organizer receives first payout</span>}
      {group.myMembership && !manage && <div className="row" style={{ gap: 6 }}><span className="text-xs text-muted">Your membership:</span><StatusBadge kind="membership" value={group.myMembership.status} /></div>}
      {manage && group.pendingApplications > 0 && <div className="row" style={{ gap: 6 }}><span className="badge badge--warning">{group.pendingApplications} pending application{group.pendingApplications === 1 ? "" : "s"}</span></div>}
      <div className="group-card__footer">
        <span className="row" style={{ gap: 6 }}><Icons.Calendar size={14} /> Starts {formatDate(group.startDate)}</span>
        <span className="row" style={{ gap: 4 }}>{manage ? <CreatorTypeBadge creatorType={group.creatorType} /> : null}<Link href={href} className="link">View group <Icons.ArrowRight size={14} style={{ display: "inline", verticalAlign: "-2px" }} /></Link></span>
      </div>
    </Card>
  );
}
