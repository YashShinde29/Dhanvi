"use client";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { groupService } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import type { Group } from "@/types/group";
import type { Contribution, MonthlyCycle } from "@/types/contribution";
import { useAsyncData } from "@/hooks/use-async-data";
import { GroupCard } from "@/features/groups/group-card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { StatCard, FinancialStatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActivityList } from "@/components/ui/activity";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/callout";
import { LinkButton } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/badge";
import { SkeletonCards, SkeletonStats } from "@/components/ui/skeleton";
import { formatDate, formatDateTime, formatMoney, greeting } from "@/lib/format";
import { statusLabel } from "@/lib/status";

interface Action { id: string; tone: "warning" | "info" | "success" | "indigo"; title: string; description: string; href: string; cta: string; sort: string }

export function UserDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [groups, pending, overdue, recorded] = await Promise.all([
      groupService.list("mine", "page=1&pageSize=50&section=ALL"),
      contributionService.mine("status=PENDING&page=1&pageSize=50"),
      contributionService.mine("status=OVERDUE&page=1&pageSize=50"),
      contributionService.mine("status=RECORDED&page=1&pageSize=8"),
    ]);
    const active = groups.items.filter((g) => g.status === "ACTIVE" && g.myMembership?.status === "ACTIVE");
    const cycles = await Promise.all(active.slice(0, 6).map(async (g) => ({ group: g, cycles: await contributionService.cycles(g.id).catch(() => [] as MonthlyCycle[]) })));
    return { groups: groups.items, active, pending: [...overdue.items, ...pending.items], pendingCount: pending.totalCount + overdue.totalCount, recorded, cycles };
  }, [user?.id]);

  const name = user?.firstName ?? "";
  if (error) return <div className="stack stack--lg"><PageHeader title={`${greeting()}, ${name}`} /><ErrorState message={error} onRetry={reload} /></div>;

  const nextContribution: Contribution | undefined = data ? [...data.pending].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] : undefined;
  const upcomingCycle = data ? data.cycles.map(({ group, cycles }) => ({ group, cycle: cycles.find((c) => c.cycleNumber === group.currentCycleNumber) })).filter((x): x is { group: Group; cycle: MonthlyCycle } => !!x.cycle && x.cycle.status !== "SELECTION_COMPLETED").sort((a, b) => a.cycle.selectionDate.localeCompare(b.cycle.selectionDate))[0] : undefined;

  const actions: Action[] = [];
  data?.groups.forEach((g) => {
    const m = g.myMembership;
    if (!m) return;
    if (m.status === "APPROVED" && g.currentRules && !(m.termsAcceptedAt && m.termsVersionId === g.currentRules.id) && ["RECRUITING", "FULLY_SUBSCRIBED"].includes(g.status))
      actions.push({ id: `terms-${g.id}`, tone: "warning", title: "Rules acceptance required", description: `Accept rules version ${g.rulesVersion} for ${g.name} so the group can start.`, href: `/groups/${g.id}`, cta: "Review rules", sort: "0" });
    if (m.status === "APPLIED") actions.push({ id: `applied-${g.id}`, tone: "info", title: "Application pending", description: `${g.name} · submitted to ${g.creatorType === "PLATFORM" ? "Dhanvi" : g.organizer?.name ?? "the organizer"}.`, href: `/groups/${g.id}`, cta: "View group", sort: "3" });
  });
  data?.pending.forEach((c) => actions.push({ id: `due-${c.id}`, tone: c.status === "OVERDUE" ? "warning" : "info", title: `${c.status === "OVERDUE" ? "Overdue" : "Contribution due"} · ${formatMoney(c.expectedAmount - c.recordedAmount)}`, description: `${c.groupName} · cycle ${c.cycleNumber} · due ${formatDate(c.dueDate)}`, href: `/groups/${c.groupId}`, cta: "View", sort: `1-${c.dueDate}` }));
  data?.cycles.forEach(({ group, cycles: list }) => {
    const cycle = list.find((c) => c.cycleNumber === group.currentCycleNumber);
    if (!cycle) return;
    if (cycle.status === "READY_FOR_SELECTION" && cycle.selectionMethod === "AUCTION") actions.push({ id: `auction-${group.id}`, tone: "indigo", title: "Auction available", description: `${group.name} · cycle ${cycle.cycleNumber} auction on ${formatDate(cycle.selectionDate)}`, href: `/groups/${group.id}/cycles/${cycle.id}/auction`, cta: "Open auction", sort: "2" });
    if (cycle.status === "SELECTION_COMPLETED") actions.push({ id: `sel-${group.id}`, tone: "success", title: "Selection completed", description: `${group.name} · cycle ${cycle.cycleNumber} result is available.`, href: `/groups/${group.id}`, cta: "View result", sort: "4" });
  });
  actions.sort((a, b) => a.sort.localeCompare(b.sort));

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Member dashboard" title={`${greeting()}, ${name}`} description="Here's where your savings groups stand today." actions={<LinkButton href="/groups" variant="secondary" icon={<Icons.Search size={16} />}>Browse groups</LinkButton>} />
      {loading && !data ? <SkeletonStats /> : (
        <div className="grid-4">
          <StatCard label="Active groups" value={data?.active.length ?? 0} icon={<Icons.Users size={18} />} hint={data && data.groups.length > data.active.length ? `${data.groups.length - data.active.length} more pending or upcoming` : undefined} />
          <FinancialStatCard label="Next contribution" amount={nextContribution ? nextContribution.expectedAmount - nextContribution.recordedAmount : null} icon={<Icons.Calendar size={18} />} hint={nextContribution ? `${nextContribution.groupName} · due ${formatDate(nextContribution.dueDate)}` : "Nothing due right now"} />
          <StatCard label="Recorded contributions" value={data?.recorded.totalCount ?? 0} icon={<Icons.CheckCircle size={18} />} hint="Across all your groups" />
          <StatCard label="Pending contributions" value={data?.pendingCount ?? 0} icon={<Icons.Clock size={18} />} hint={data && data.pending.some((c) => c.status === "OVERDUE") ? `${data.pending.filter((c) => c.status === "OVERDUE").length} overdue` : "Including overdue"} />
        </div>
      )}
      {upcomingCycle && (
        <Card>
          <CardBody className="row row--between">
            <div className="row" style={{ gap: 12 }}>
              <span className="stat__icon" style={{ margin: 0 }}>{upcomingCycle.cycle.selectionMethod === "AUCTION" ? <Icons.Gavel size={18} /> : <Icons.Shuffle size={18} />}</span>
              <div>
                <div className="text-strong">Upcoming {upcomingCycle.cycle.selectionMethod === "AUCTION" ? "auction" : "selection"} · {upcomingCycle.group.name}</div>
                <div className="text-sm text-muted">Cycle {upcomingCycle.cycle.cycleNumber} · {formatDate(upcomingCycle.cycle.selectionDate)} · {statusLabel("cycle", upcomingCycle.cycle.status)}</div>
              </div>
            </div>
            <LinkButton href={upcomingCycle.cycle.selectionMethod === "AUCTION" ? `/groups/${upcomingCycle.group.id}/cycles/${upcomingCycle.cycle.id}/auction` : `/groups/${upcomingCycle.group.id}`} variant="secondary" size="sm">View</LinkButton>
          </CardBody>
        </Card>
      )}

      <section className="section">
        <SectionHeader title="My active groups" actions={<Link className="link text-sm" href="/my-groups">All my groups →</Link>} />
        {loading && !data ? <SkeletonCards count={3} /> : data && data.active.length === 0 ? (
          <EmptyState icon={<Icons.Users size={24} />} title="You haven't joined a savings group yet" description="Browse open groups, compare their rules and apply for a position." action={<LinkButton href="/groups" icon={<Icons.Search size={16} />}>Browse groups</LinkButton>} />
        ) : (
          <div className="group-grid">{data?.active.slice(0, 4).map((g) => <GroupCard key={g.id} group={g} href={`/groups/${g.id}`} />)}</div>
        )}
      </section>

      <div className="grid-2">
        <Card>
          <CardHeader title="Upcoming actions" subtitle={actions.length ? `${actions.length} item${actions.length === 1 ? " needs" : "s need"} your attention` : "You're all caught up"} />
          <CardBody>
            {actions.length === 0 ? <p className="text-sm text-muted">Nothing needs your attention right now.</p> : (
              <div className="stack" style={{ gap: 10 }}>
                {actions.slice(0, 6).map((a) => (
                  <Link key={a.id} href={a.href} className={`attention attention--${a.tone}`} style={{ padding: 12 }}>
                    <span className="attention__text"><span className="attention__title">{a.title}</span><span className="attention__desc">{a.description}</span></span>
                    <span className="link text-sm" style={{ whiteSpace: "nowrap" }}>{a.cta} →</span>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activity" subtitle="Latest recorded contributions" />
          <CardBody>
            {data && data.recorded.items.length === 0 ? <p className="text-sm text-muted">Recorded contributions will appear here.</p> : (
              <ActivityList items={(data?.recorded.items ?? []).slice(0, 6).map((c) => ({ id: c.id, icon: <Icons.Wallet size={16} />, title: <>Contribution recorded · <span className="amount">{formatMoney(c.recordedAmount)}</span></>, description: <>{c.groupName} · cycle {c.cycleNumber} · <StatusBadge kind="contribution" value={c.status} /></>, time: c.recordedAt ? formatDateTime(c.recordedAt, c.groupTimeZone) : undefined }))} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
