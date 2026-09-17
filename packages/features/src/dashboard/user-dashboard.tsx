"use client";
import Link from "next/link";
import { useAuth } from "@dhanvi/auth";
import { groupService, contributionService, payoutService, auctionService } from "@dhanvi/api-client";
import type { Auction, Contribution, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, greeting } from "@dhanvi/utils";
import { GroupCard } from "../groups/group-card";
import { NextActionList, contributionAction, memberGroupActions, memberPayoutActions, type WorkflowAction } from "../workflow";
import { latestOwnBid, personalState } from "../auctions/auction-model";
import { PageHeader, SectionHeader, EmptyState, ErrorState, LinkButton, Icons, SkeletonCards } from "@dhanvi/ui";

/**
 * Member home. Answers "what do I need to do today?" — one list of next actions (one button each), what you're
 * waiting on, then your groups. No statistics, no operational data.
 */
export function UserDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [groups, pending, overdue, payouts, account] = await Promise.all([
      groupService.list("mine", "page=1&pageSize=50&section=ALL"),
      contributionService.mine("status=PENDING&page=1&pageSize=50"),
      contributionService.mine("status=OVERDUE&page=1&pageSize=50"),
      payoutService.list(false, "page=1&pageSize=50").catch(() => null),
      payoutService.account().catch(() => null),
    ]);
    const active = groups.items.filter((g) => g.status === "ACTIVE" && g.myMembership?.status === "ACTIVE");
    const cycles = await Promise.all(active.slice(0, 6).map(async (g) => ({ group: g, cycles: await contributionService.cycles(g.id).catch(() => [] as MonthlyCycle[]) })));
    // Live auction state only for auction cycles that have reached the auction stage (bounded, no per-group fan-out otherwise).
    const auctions = new Map<string, Auction>();
    await Promise.all(cycles.map(async ({ group, cycles: list }) => { const c = list.find((x) => x.cycleNumber === group.currentCycleNumber); if (c && c.selectionMethod === "AUCTION" && ["READY_FOR_SELECTION", "CONTRIBUTIONS_COMPLETE"].includes(c.status)) { const a = await auctionService.get(group.id, c.id).catch(() => null); if (a) auctions.set(group.id, a); } }));
    return { groups: groups.items, active, pending: [...overdue.items, ...pending.items], cycles, payouts: payouts?.items ?? [], account, auctions };
  }, [user?.id]);
  const name = user?.firstName ?? "";
  if (error) return <div className="stack stack--lg"><PageHeader title={`${greeting()}, ${name}`} /><ErrorState message={error} onRetry={reload} /></div>;

  const groupItems = data ? memberGroupActions(data.groups) : { actions: [], waiting: [] };
  const payoutItems = data ? memberPayoutActions(data.payouts, data.account) : { actions: [], waiting: [] };
  const settled = (c: Contribution) => c.status === "RECORDED" || c.financialStatus.toUpperCase() === "SETTLED";
  const cycleStatus = new Map<string, string>(); data?.cycles.forEach(({ cycles: list }) => list.forEach((c) => cycleStatus.set(c.id, c.status)));
  const collectingNow = (c: Contribution) => { const status = cycleStatus.get(c.cycleId); return !status || status === "COLLECTING_CONTRIBUTIONS"; };
  const nextActions: WorkflowAction[] = [...groupItems.actions, ...payoutItems.actions, ...(data?.pending ?? []).filter((c) => !settled(c) && collectingNow(c)).map((c) => ({ ...contributionAction(c), actionHref: `/groups/${c.groupId}` }))];
  const waiting: WorkflowAction[] = [...groupItems.waiting, ...payoutItems.waiting];
  data?.cycles.forEach(({ group, cycles: list }) => {
    const cycle = list.find((c) => c.cycleNumber === group.currentCycleNumber);
    if (!cycle) return;
    const own = data.pending.find((c) => c.cycleId === cycle.id);
    const who = group.creatorType === "PLATFORM" ? "Dhanvi admin" : "the organizer";
    if (cycle.status === "COLLECTING_CONTRIBUTIONS" && !own && cycle.pendingMemberCount > 0) waiting.push({ id: `others-${group.id}`, title: `${group.name} · waiting for ${cycle.pendingMemberCount} other member${cycle.pendingMemberCount === 1 ? "" : "s"} to contribute`, description: `Cycle ${cycle.cycleNumber} · your contribution is complete.`, status: "waiting", responsibleRole: "USER", actionLabel: "View group", actionHref: `/groups/${group.id}` });
    if (cycle.selectionMethod === "AUCTION" && data.auctions.get(group.id)) {
      const a = data.auctions.get(group.id)!; const href = `/groups/${group.id}/cycles/${cycle.id}/auction`; const state = personalState(a); const own = latestOwnBid(a);
      if (a.status === "OPEN" && state !== "INELIGIBLE") nextActions.push({ id: `auction-${group.id}`, title: `Auction is live · Cycle ${cycle.cycleNumber} — ${group.name}`, description: state === "LEADING" ? `You're leading with ${formatMoney(own!.discountAmount)}. Current projected payout ${formatMoney(a.potentialWinnerPayout)}.` : state === "OUTBID" ? `You have been outbid. Minimum next bid ${formatMoney(a.minimumNextBid)}.` : `You haven't bid yet. Minimum bid ${formatMoney(a.minimumNextBid)} · projected payout ${formatMoney(a.groupValue - a.minimumNextBid)}.`, status: state === "OUTBID" || state === "NOT_BID" ? "attention" : "current", responsibleRole: "USER", actionLabel: "Enter auction", actionHref: href, priority: state === "LEADING" ? 25 : 2 });
      else if (a.status === "OPEN") waiting.push({ id: `auction-${group.id}`, title: `Auction live · ${group.name}`, description: "You cannot bid in this cycle; the result appears when it closes.", status: "waiting", responsibleRole: "USER", actionLabel: "View auction", actionHref: href });
      else if (a.status === "SCHEDULED") waiting.push({ id: `auction-${group.id}`, title: `Cycle ${cycle.cycleNumber} auction scheduled · ${group.name}`, description: `Opens ${formatDate(cycle.selectionDate)} once ${group.creatorType === "PLATFORM" ? "Dhanvi" : "the organizer"} starts it. No action required yet.`, status: "waiting", responsibleRole: group.creatorType === "PLATFORM" ? "ADMIN" : "ORGANIZER", actionLabel: "View auction", actionHref: href });
    }
    else if (cycle.status === "READY_FOR_SELECTION" || cycle.status === "CONTRIBUTIONS_COMPLETE") waiting.push({ id: `sel-${group.id}`, title: `${group.name} · waiting for the selection`, description: `All cycle ${cycle.cycleNumber} contributions are complete. ${who} starts the selection.`, status: "waiting", responsibleRole: group.creatorType === "PLATFORM" ? "ADMIN" : "ORGANIZER", actionLabel: "View group", actionHref: `/groups/${group.id}` });
    else if (cycle.status === "SELECTION_COMPLETED" || cycle.status === "PAYOUT_PENDING") waiting.push({ id: `payout-${group.id}`, title: `${group.name} · cycle ${cycle.cycleNumber} payout in progress`, description: "Dhanvi is processing this cycle's payout. The next cycle opens once it settles.", status: "waiting", responsibleRole: "ADMIN", actionLabel: "View result", actionHref: `/groups/${group.id}?tab=selection` });
  });
  if (user?.organizerStatus === "PENDING" || user?.organizerStatus === "UNDER_REVIEW") waiting.push({ id: "org-app", title: "Organizer application submitted", description: "Waiting for: Dhanvi admin review.", status: "waiting", responsibleRole: "ADMIN", actionLabel: "View application", actionHref: "/organizer/application-status" });

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Home" title={`${greeting()}, ${name}`} description="What you need to do, and what you're waiting on." />
      <section className="section" aria-labelledby="next-actions">
        <SectionHeader title={<span id="next-actions">Your next actions</span>} description={nextActions.length ? `${nextActions.length} item${nextActions.length === 1 ? " needs" : "s need"} you` : undefined} />
        {loading && !data ? <SkeletonCards count={1} /> : <NextActionList actions={nextActions} viewer="member" limit={6} emptyTitle="You're all caught up" emptyDescription={waiting.length ? "Nothing needs you right now — see what you're waiting on below." : data && data.groups.length === 0 ? "Join a group to start saving together." : "Nothing is due right now."} />}
      </section>
      {waiting.length > 0 && (
        <section className="section" aria-labelledby="waiting-on">
          <SectionHeader title={<span id="waiting-on">Waiting for</span>} description="These move when others act. Nothing for you to do." />
          <NextActionList actions={waiting} viewer="member" limit={5} />
        </section>
      )}
      <section className="section">
        <SectionHeader title="My groups" actions={data && data.groups.length > 0 ? <Link className="link text-sm" href="/my-groups">All my groups →</Link> : undefined} />
        {loading && !data ? <SkeletonCards count={3} /> : data && data.groups.length === 0 ? (
          <EmptyState icon={<Icons.Users size={24} />} title="No active groups" description="Browse available groups to get started." action={<LinkButton href="/groups" icon={<Icons.Search size={16} />}>Browse groups</LinkButton>} />
        ) : (
          <div className="group-grid">{(data?.active.length ? data.active : data?.groups ?? []).slice(0, 3).map((g) => <GroupCard key={g.id} group={g} href={`/groups/${g.id}`} />)}</div>
        )}
      </section>
    </div>
  );
}
