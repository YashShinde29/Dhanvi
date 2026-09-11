"use client";
import Link from "next/link";
import { groupService } from "@/services/group.service";
import { organizerService } from "@/services/organizer.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, ErrorState } from "@/components/ui/callout";
import { LinkButton } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { CreatorTypeBadge, StatusBadge } from "@/components/ui/badge";
import { SkeletonStats, SkeletonText } from "@/components/ui/skeleton";
import { formatDate, formatMoney } from "@/lib/format";

const count = (status: string) => groupService.list("admin", `page=1&pageSize=1&status=${status}`).then((p) => p.totalCount);

export function AdminDashboard() {
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [recentGroups, active, recruiting, ready, full, suspended, pendingApps, underReview, approved] = await Promise.all([
      groupService.list("admin", "page=1&pageSize=6"), count("ACTIVE"), count("RECRUITING"), count("READY_TO_START"), count("FULLY_SUBSCRIBED"), count("SUSPENDED"),
      organizerService.applications(1, 6, "PENDING"), organizerService.applications(1, 1, "UNDER_REVIEW"), organizerService.applications(1, 1, "APPROVED"),
    ]);
    return { recentGroups, active, recruiting, ready, full, suspended, pendingApps, underReview: underReview.totalCount, approved: approved.totalCount };
  }, []);
  if (error) return <div className="stack stack--lg"><PageHeader eyebrow="Administration" title="Platform overview" /><ErrorState message={error} onRetry={reload} /></div>;
  const pendingReview = (data?.pendingApps.totalCount ?? 0) + (data?.underReview ?? 0);
  const issues = pendingReview + (data?.ready ?? 0) + (data?.full ?? 0) + (data?.suspended ?? 0);
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Administration" title="Platform overview" description="Operational status across organizers and groups." actions={<LinkButton href="/admin/groups/create" variant="secondary" icon={<Icons.Plus size={16} />}>Create platform group</LinkButton>} />
      {loading && !data ? <SkeletonStats count={6} /> : (
        <div className="grid-3">
          <StatCard label="Approved organizers" value={data?.approved ?? 0} icon={<Icons.BadgeCheck size={18} />} compact />
          <StatCard label="Pending organizer applications" value={pendingReview} icon={<Icons.Inbox size={18} />} compact accent={pendingReview > 0} hint={data?.underReview ? `${data.underReview} under review` : undefined} />
          <StatCard label="Active groups" value={data?.active ?? 0} icon={<Icons.Layers size={18} />} compact hint="Each active group runs one cycle at a time" />
          <StatCard label="Recruiting groups" value={data?.recruiting ?? 0} icon={<Icons.Users size={18} />} compact />
          <StatCard label="Groups awaiting activation" value={(data?.ready ?? 0) + (data?.full ?? 0)} icon={<Icons.Play size={18} />} compact hint={`${data?.ready ?? 0} ready · ${data?.full ?? 0} fully subscribed`} />
          <StatCard label="Needs attention" value={issues} icon={<Icons.Alert size={18} />} compact accent={issues > 0} hint={data?.suspended ? `${data.suspended} suspended` : "Applications + activations + suspensions"} />
        </div>
      )}
      <div className="grid-2">
        <Card>
          <CardHeader title="Recent organizer applications" subtitle="Pending review" actions={<Link className="link text-sm" href="/admin/organizers">Review queue →</Link>} />
          <CardBody>
            {loading && !data ? <SkeletonText /> : data?.pendingApps.items.length === 0 ? <p className="text-sm text-muted">No applications are waiting for review.</p> : (
              <div className="list">
                {data?.pendingApps.items.map((a) => (
                  <Link key={a.id} href="/admin/organizers" className="list__item">
                    <Avatar name={a.applicant} size="sm" />
                    <span className="list__text"><span className="list__title">{a.applicant}</span><span className="list__desc">{a.email} · submitted {formatDate(a.submittedAt)}</span></span>
                    <StatusBadge kind="organizer" value={a.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent groups" actions={<Link className="link text-sm" href="/admin/groups">All groups →</Link>} />
          <CardBody>
            {loading && !data ? <SkeletonText /> : data?.recentGroups.items.length === 0 ? <p className="text-sm text-muted">No groups have been created yet.</p> : (
              <div className="list">
                {data?.recentGroups.items.map((g) => (
                  <Link key={g.id} href={`/admin/groups/${g.id}`} className="list__item">
                    <span className="list__text"><span className="list__title">{g.name}</span><span className="list__desc">{formatMoney(g.groupValue)} · {g.currentMemberCount}/{g.memberLimit} members · {g.creatorType === "PLATFORM" ? "Dhanvi" : g.organizer?.name}</span></span>
                    <span className="row" style={{ gap: 6 }}><CreatorTypeBadge creatorType={g.creatorType} /><StatusBadge kind="group" value={g.status} /></span>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      <Callout variant="neutral" title="Audit activity">A consolidated audit log browser is not available in this release. Group and auction events are recorded server-side and surface within each group&apos;s auction history.</Callout>
    </div>
  );
}
