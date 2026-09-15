"use client";
import Link from "next/link";
import { useAuth } from "@dhanvi/auth";
import { groupService, contributionService, payoutService } from "@dhanvi/api-client";
import type { Group, Contribution, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatDateTime, formatMoney, greeting, statusLabel } from "@dhanvi/utils";
import { GroupCard } from "../groups/group-card";
import { NextActionList, contributionAction, memberGroupActions, memberPayoutActions, type WorkflowAction } from "../workflow";
import { PageHeader, SectionHeader, StatCard, FinancialStatCard, Card, CardBody, CardHeader, ActivityList, EmptyState, ErrorState, LinkButton, Icons, StatusBadge, SkeletonCards, SkeletonStats } from "@dhanvi/ui";

export function UserDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [groups, pending, overdue, recorded, payouts, account] = await Promise.all([
      groupService.list("mine", "page=1&pageSize=50&section=ALL"),
      contributionService.mine("status=PENDING&page=1&pageSize=50"),
      contributionService.mine("status=OVERDUE&page=1&pageSize=50"),
      contributionService.mine("status=RECORDED&page=1&pageSize=8"),
      payoutService.list(false, "page=1&pageSize=50").catch(() => null),
      payoutService.account().catch(() => null),
    ]);
    const active = groups.items.filter((g) => g.status === "ACTIVE" && g.myMembership?.status === "ACTIVE");
    const cycles = await Promise.all(active.slice(0, 6).map(async (g) => ({ group: g, cycles: await contributionService.cycles(g.id).catch(() => [] as MonthlyCycle[]) })));
    return { groups: groups.items, active, pending: [...overdue.items, ...pending.items], pendingCount: pending.totalCount + overdue.totalCount, recorded, cycles, payouts: payouts?.items ?? [], account };
  }, [user?.id]);

  const name = user?.firstName ?? "";
  if (error) return <div className="stack stack--lg"><PageHeader title={`${greeting()}, ${name}`} /><ErrorState message={error} onRetry={reload} /></div>;

  const nextContribution: Contribution | undefined = data ? [...data.pending].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] : undefined;
  const upcomingCycle = data ? data.cycles.map(({ group, cycles }) => ({ group, cycle: cycles.find((c) => c.cycleNumber === group.currentCycleNumber) })).filter((x): x is { group: Group; cycle: MonthlyCycle } => !!x.cycle && x.cycle.status !== "SELECTION_COMPLETED").sort((a, b) => a.cycle.selectionDate.localeCompare(b.cycle.selectionDate))[0] : undefined;

  // "Your next actions" and "Waiting on" come only from backend state: memberships, contributions, cycles, payouts.
  const groupItems = data ? memberGroupActions(data.groups) : { actions: [], waiting: [] };
  const payoutItems = data ? memberPayoutActions(data.payouts, data.account) : { actions: [], waiting: [] };
  const settled = (c: Contribution) => c.status === "RECORDED" || c.financialStatus.toUpperCase() === "SETTLED";
  // Only contributions of a cycle that is actually collecting are actionable now; future cycles are not "due".
  const cycleStatus = new Map<string, string>(); data?.cycles.forEach(({ cycles: list }) => list.forEach((c) => cycleStatus.set(c.id, c.status)));
  const collectingNow = (c: Contribution) => { const status = cycleStatus.get(c.cycleId); return !status || status === "COLLECTING_CONTRIBUTIONS"; };
  const nextActions: WorkflowAction[] = [...groupItems.actions, ...payoutItems.actions, ...(data?.pending ?? []).filter((c) => !settled(c) && collectingNow(c)).map(contributionAction)];
  const upcoming = (data?.pending ?? []).filter((c) => !settled(c) && !collectingNow(c));
  const waiting: WorkflowAction[] = [...groupItems.waiting, ...payoutItems.waiting];
  data?.cycles.forEach(({ group, cycles: list }) => {
    const cycle = list.find((c) => c.cycleNumber === group.currentCycleNumber);
    if (!cycle) return;
    const own = data.pending.find((c) => c.cycleId === cycle.id);
    if (cycle.status === "COLLECTING_CONTRIBUTIONS" && !own && cycle.pendingMemberCount > 0) waiting.push({ id: `others-${group.id}`, title: `Waiting for ${cycle.pendingMemberCount} other member${cycle.pendingMemberCount === 1 ? "" : "s"} to pay · ${group.name}`, description: `Cycle ${cycle.cycleNumber} · your contribution is complete.`, status: "waiting", responsibleRole: "USER", actionLabel: "View group", actionHref: `/groups/${group.id}` });
    if (cycle.status === "READY_FOR_SELECTION" && cycle.selectionMethod === "AUCTION") nextActions.push({ id: `auction-${group.id}`, title: `Auction available · ${group.name}`, description: `Cycle ${cycle.cycleNumber} auction on ${formatDate(cycle.selectionDate)}. You are eligible to participate if you have not received your payout.`, status: "current", responsibleRole: "USER", actionLabel: "View auction", actionHref: `/groups/${group.id}/cycles/${cycle.id}/auction`, priority: 15 });
    else if (cycle.status === "READY_FOR_SELECTION" || cycle.status === "CONTRIBUTIONS_COMPLETE") waiting.push({ id: `sel-${group.id}`, title: `Waiting for selection · ${group.name}`, description: `All cycle ${cycle.cycleNumber} contributions are complete. The ${group.creatorType === "PLATFORM" ? "Dhanvi admin" : "organizer"} starts the selection.`, status: "waiting", responsibleRole: "ORGANIZER", actionLabel: "View group", actionHref: `/groups/${group.id}` });
    else if (cycle.status === "SELECTION_COMPLETED") waiting.push({ id: `payout-${group.id}`, title: `Selection completed · payout being prepared · ${group.name}`, description: `Cycle ${cycle.cycleNumber} result is available.`, status: "waiting", responsibleRole: "ADMIN", actionLabel: "View result", actionHref: `/groups/${group.id}?tab=cycles` });
    else if (cycle.status === "PAYOUT_PENDING") waiting.push({ id: `pp-${group.id}`, title: `Payout processing · ${group.name}`, description: `Cycle ${cycle.cycleNumber} payout is with the provider.`, status: "waiting", responsibleRole: "SYSTEM", actionLabel: "View group", actionHref: `/groups/${group.id}` });
  });
  upcoming.slice(0, 3).forEach((c) => waiting.push({ id: `up-${c.id}`, title: `Cycle ${c.cycleNumber} contribution opens later · ${c.groupName}`, description: `${formatMoney(c.expectedAmount)} due ${formatDate(c.dueDate)}. It becomes payable when the cycle starts.`, status: "upcoming", responsibleRole: "SYSTEM", actionLabel: "View group", actionHref: `/groups/${c.groupId}` }));
  if (user?.organizerStatus === "PENDING" || user?.organizerStatus === "UNDER_REVIEW") waiting.push({ id: "org-app", title: "Waiting for organizer approval", description: "Dhanvi is reviewing your organizer application.", status: "waiting", responsibleRole: "ADMIN", actionLabel: "View application", actionHref: "/organizer/application-status" });

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Member dashboard" title={`${greeting()}, ${name}`} description="What needs your attention, what you're waiting on, and where your groups stand." actions={<LinkButton href="/groups" variant="secondary" icon={<Icons.Search size={16} />}>Browse groups</LinkButton>} />
      <section className="section" aria-labelledby="next-actions">
        <SectionHeader title={<span id="next-actions">Your next actions</span>} description={nextActions.length ? `${nextActions.length} item${nextActions.length === 1 ? "" : "s"} need you` : undefined} />
        {loading && !data ? <SkeletonCards count={1} /> : <NextActionList actions={nextActions} viewer="member" limit={6} />}
      </section>
      {waiting.length > 0 && (
        <section className="section" aria-labelledby="waiting-on">
          <SectionHeader title={<span id="waiting-on">Waiting on</span>} description="Nothing for you to do here — these move when others act." />
          <NextActionList actions={waiting} viewer="member" limit={5} />
        </section>
      )}
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

      <div>
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
