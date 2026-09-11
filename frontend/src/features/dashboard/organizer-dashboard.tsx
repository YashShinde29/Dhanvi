"use client";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { groupService } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { StatCard, FinancialStatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Callout, ErrorState } from "@/components/ui/callout";
import { LinkButton } from "@/components/ui/button";
import { Icons } from "@/components/ui/icons";
import { GroupTypeBadge, StatusBadge } from "@/components/ui/badge";
import { SkeletonStats, SkeletonText } from "@/components/ui/skeleton";
import { formatDate, formatMoney, greeting } from "@/lib/format";

interface Attention { id: string; tone: "warning" | "info" | "success" | "indigo"; count: string; title: string; description: string; href: string }

export function OrganizerDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const page = await groupService.list("organizer", "page=1&pageSize=100");
    const active = page.items.filter((g) => g.status === "ACTIVE");
    const cycles = await Promise.all(active.slice(0, 8).map(async (g) => ({ group: g, current: (await contributionService.cycles(g.id, "organizer").catch(() => [] as MonthlyCycle[])).find((c) => c.cycleNumber === g.currentCycleNumber) })));
    return { groups: page.items, total: page.totalCount, active, cycles };
  }, [user?.id]);

  if (error) return <div className="stack stack--lg"><PageHeader title={`${greeting()}, ${user?.firstName ?? ""}`} /><ErrorState message={error} onRetry={reload} /></div>;
  const groups: Group[] = data?.groups ?? [];
  const recruiting = groups.filter((g) => g.status === "RECRUITING");
  const pendingApplications = groups.reduce((sum, g) => sum + g.pendingApplications, 0);
  const expectedMonthly = (data?.active ?? []).reduce((sum, g) => sum + g.monthlyContribution * g.memberLimit, 0);
  const currentCycles = (data?.cycles ?? []).filter((x): x is { group: Group; current: MonthlyCycle } => !!x.current);
  const recordedThisCycle = currentCycles.reduce((sum, x) => sum + x.current.recordedContributionAmount, 0);
  const readyForSelection = currentCycles.filter((x) => x.current.status === "READY_FOR_SELECTION");

  const attention: Attention[] = [
    ...groups.filter((g) => g.pendingApplications > 0).map((g) => ({ id: `apps-${g.id}`, tone: "warning" as const, count: String(g.pendingApplications), title: `Pending application${g.pendingApplications === 1 ? "" : "s"}`, description: g.name, href: `/organizer/groups/${g.id}/applications` })),
    ...groups.filter((g) => g.status === "FULLY_SUBSCRIBED").map((g) => ({ id: `full-${g.id}`, tone: "indigo" as const, count: "✓", title: "Fully subscribed — confirm ready", description: g.name, href: `/organizer/groups/${g.id}` })),
    ...groups.filter((g) => g.status === "READY_TO_START").map((g) => ({ id: `ready-${g.id}`, tone: "success" as const, count: "▶", title: "Ready to activate", description: `${g.name} · starts ${formatDate(g.startDate)}`, href: `/organizer/groups/${g.id}` })),
    ...readyForSelection.map(({ group, current }) => ({ id: `sel-${group.id}`, tone: "indigo" as const, count: String(current.cycleNumber), title: current.selectionMethod === "AUCTION" ? "Auction ready" : "Selection ready", description: `${group.name} · cycle ${current.cycleNumber}`, href: current.selectionMethod === "AUCTION" ? `/organizer/groups/${group.id}/cycles/${current.id}/auction` : `/organizer/groups/${group.id}` })),
    ...currentCycles.filter((x) => x.current.status === "COLLECTING_CONTRIBUTIONS" && x.current.pendingMemberCount > 0).map(({ group, current }) => ({ id: `contrib-${group.id}`, tone: "info" as const, count: String(current.pendingMemberCount), title: "Outstanding contributions", description: `${group.name} · cycle ${current.cycleNumber} · ${formatMoney(current.recordedContributionAmount)} of ${formatMoney(current.expectedPoolAmount)}`, href: `/organizer/groups/${group.id}/cycles/${current.id}/contributions` })),
    ...groups.filter((g) => g.status === "DRAFT").map((g) => ({ id: `draft-${g.id}`, tone: "info" as const, count: "—", title: "Draft not published", description: g.name, href: `/organizer/groups/${g.id}` })),
  ];

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer dashboard" title={`${greeting()}, ${user?.firstName ?? ""}`} description="An operational view of the groups you manage." actions={<LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton>} />
      {user?.organizerStatus === "SUSPENDED" && <Callout variant="warning" title="Organizer access suspended">You can view your groups but cannot create or manage them while suspended.</Callout>}
      {loading && !data ? <SkeletonStats count={6} /> : (
        <div className="grid-3">
          <StatCard label="Active groups" value={data?.active.length ?? 0} icon={<Icons.Layers size={18} />} hint={`${data?.total ?? 0} groups total`} />
          <StatCard label="Recruiting groups" value={recruiting.length} icon={<Icons.Users size={18} />} hint={recruiting.length ? `${recruiting.reduce((s, g) => s + g.availableSlots, 0)} open positions` : "No open recruitment"} />
          <StatCard label="Pending applications" value={pendingApplications} icon={<Icons.Inbox size={18} />} hint={pendingApplications ? "Waiting for review" : "Inbox clear"} accent={pendingApplications > 0} />
          <FinancialStatCard label="Monthly expected collection" amount={expectedMonthly} icon={<Icons.Wallet size={18} />} hint="Across active groups" />
          <FinancialStatCard label="Recorded this cycle" amount={recordedThisCycle} icon={<Icons.CheckCircle size={18} />} hint={currentCycles.length ? `${currentCycles.reduce((s, x) => s + x.current.fullyRecordedMemberCount, 0)} of ${currentCycles.reduce((s, x) => s + x.current.expectedMemberCount, 0)} members complete` : "No active cycles"} />
          <StatCard label="Ready for selection" value={readyForSelection.length} icon={<Icons.Sparkle size={18} />} hint={readyForSelection.length ? "Draw or auction can run" : "None ready"} />
        </div>
      )}
      <section className="section">
        <SectionHeader title="Groups needing attention" description={attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"}` : undefined} />
        {loading && !data ? <Card><CardBody><SkeletonText /></CardBody></Card> : groups.length === 0 ? (
          <EmptyState icon={<Icons.Layers size={24} />} title="You haven't created a group yet" description="Set up your first savings group to start accepting applications." action={<LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton>} />
        ) : attention.length === 0 ? <Callout variant="success">Nothing needs your attention. All groups are on track.</Callout> : (
          <div className="grid-2">
            {attention.slice(0, 8).map((a) => (
              <Link key={a.id} href={a.href} className={`attention attention--${a.tone}`}>
                <span className="attention__count">{a.count}</span>
                <span className="attention__text"><span className="attention__title">{a.title}</span><span className="attention__desc">{a.description}</span></span>
                <Icons.ChevronRight size={18} style={{ color: "var(--color-text-muted)" }} />
              </Link>
            ))}
          </div>
        )}
      </section>
      <Card>
        <CardHeader title="Recent groups" actions={<Link className="link text-sm" href="/organizer/groups">All groups →</Link>} />
        <CardBody>
          {groups.length === 0 ? <p className="text-sm text-muted">Your groups will appear here.</p> : (
            <div className="list">
              {groups.slice(0, 6).map((g) => (
                <Link key={g.id} href={`/organizer/groups/${g.id}`} className="list__item">
                  <span className="list__text"><span className="list__title">{g.name}</span><span className="list__desc">{formatMoney(g.groupValue)} · {g.currentMemberCount}/{g.memberLimit} members · {g.currentCycleNumber ? `cycle ${g.currentCycleNumber} of ${g.durationMonths}` : `starts ${formatDate(g.startDate)}`}</span></span>
                  <span className="row" style={{ gap: 6 }}><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} /></span>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
