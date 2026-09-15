"use client";
import Link from "next/link";
import { useAuth } from "@dhanvi/auth";
import { groupService, contributionService } from "@dhanvi/api-client";
import type { Group, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, greeting } from "@dhanvi/utils";
import { NextActionList, type WorkflowAction } from "../workflow";
import { PageHeader, SectionHeader, StatCard, FinancialStatCard, Card, CardBody, CardHeader, EmptyState, Callout, ErrorState, LinkButton, Icons, GroupTypeBadge, StatusBadge, SkeletonStats, SkeletonText } from "@dhanvi/ui";

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

  // Actions the organizer must take, versus things waiting on members.
  const actions: WorkflowAction[] = [
    ...groups.filter((g) => g.pendingApplications > 0).map((g): WorkflowAction => ({ id: `apps-${g.id}`, title: `Review ${g.pendingApplications} membership application${g.pendingApplications === 1 ? "" : "s"} · ${g.name}`, description: `${g.availableSlots} position${g.availableSlots === 1 ? "" : "s"} still open.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Review applications", actionHref: `/organizer/groups/${g.id}/applications`, priority: 10 })),
    ...groups.filter((g) => g.status === "FULLY_SUBSCRIBED").map((g): WorkflowAction => ({ id: `full-${g.id}`, title: `Capacity reached · confirm ${g.name} is ready`, description: "Available once every approved member has accepted the rules.", status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Open group", actionHref: `/organizer/groups/${g.id}`, priority: 12 })),
    ...groups.filter((g) => g.status === "READY_TO_START").map((g): WorkflowAction => ({ id: `ready-${g.id}`, title: `Start ${g.name}`, description: `Ready to activate · first cycle from ${formatDate(g.startDate)}.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Activate group", actionHref: `/organizer/groups/${g.id}`, priority: 5 })),
    ...readyForSelection.map(({ group, current }): WorkflowAction => ({ id: `sel-${group.id}`, title: `${current.selectionMethod === "AUCTION" ? "Run the auction" : "Start the selection"} · ${group.name}`, description: `Cycle ${current.cycleNumber} · all contributions are complete.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: current.selectionMethod === "AUCTION" ? "Open auction" : "Run selection", actionHref: current.selectionMethod === "AUCTION" ? `/organizer/groups/${group.id}/cycles/${current.id}/auction` : `/organizer/groups/${group.id}?tab=cycles`, priority: 3 })),
    ...currentCycles.filter((x) => x.current.status === "COLLECTING_CONTRIBUTIONS" && x.current.collectionMode !== "RAZORPAY" && x.current.pendingMemberCount > 0).map(({ group, current }): WorkflowAction => ({ id: `rec-${group.id}`, title: `Record ${current.pendingMemberCount} outstanding contribution${current.pendingMemberCount === 1 ? "" : "s"} · ${group.name}`, description: `Cycle ${current.cycleNumber} · due ${formatDate(current.contributionDueDate)} · ${formatMoney(current.recordedContributionAmount)} of ${formatMoney(current.expectedPoolAmount)} recorded.`, status: "current", responsibleRole: "ORGANIZER", actionLabel: "Manage contributions", actionHref: `/organizer/groups/${group.id}/cycles/${current.id}/contributions`, priority: 20 })),
    ...groups.filter((g) => g.status === "DRAFT").map((g): WorkflowAction => ({ id: `draft-${g.id}`, title: `Continue group setup · ${g.name}`, description: "Saved as a draft. Publish it to start accepting applications.", status: "current", responsibleRole: "ORGANIZER", actionLabel: "Continue", actionHref: `/organizer/groups/${g.id}`, priority: 30 })),
  ];
  const waiting: WorkflowAction[] = [
    ...groups.filter((g) => g.status === "RECRUITING" && g.pendingApplications === 0 && g.availableSlots > 0).map((g): WorkflowAction => ({ id: `wait-fill-${g.id}`, title: `Waiting for ${g.availableSlots} more member${g.availableSlots === 1 ? "" : "s"} · ${g.name}`, description: `${g.currentMemberCount} of ${g.memberLimit} positions filled.`, status: "waiting", responsibleRole: "USER", actionLabel: "View group", actionHref: `/organizer/groups/${g.id}` })),
    ...currentCycles.filter((x) => x.current.status === "COLLECTING_CONTRIBUTIONS" && x.current.collectionMode === "RAZORPAY" && x.current.pendingMemberCount > 0).map(({ group, current }): WorkflowAction => ({ id: `wait-pay-${group.id}`, title: `Waiting for ${current.pendingMemberCount} member${current.pendingMemberCount === 1 ? "" : "s"} to pay · ${group.name}`, description: `Cycle ${current.cycleNumber} · ${current.financiallySettledMemberCount} of ${current.expectedMemberCount} settled through Razorpay.`, status: "waiting", responsibleRole: "USER", actionLabel: "View contributions", actionHref: `/organizer/groups/${group.id}/cycles/${current.id}/contributions` })),
    ...currentCycles.filter((x) => x.current.status === "SELECTION_COMPLETED" || x.current.status === "PAYOUT_PENDING").map(({ group, current }): WorkflowAction => ({ id: `wait-payout-${group.id}`, title: `${current.status === "PAYOUT_PENDING" ? "Payout processing" : "Payout being prepared by Dhanvi"} · ${group.name}`, description: `Cycle ${current.cycleNumber}.`, status: "waiting", responsibleRole: "ADMIN", actionLabel: "View payouts", actionHref: `/organizer/groups/${group.id}/payouts` })),
  ];

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer dashboard" title={`${greeting()}, ${user?.firstName ?? ""}`} description="What needs you, what is waiting on members, and how your groups are doing." actions={<LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton>} />
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
      <section className="section" aria-labelledby="org-actions">
        <SectionHeader title={<span id="org-actions">Actions required</span>} description={actions.length ? `${actions.length} item${actions.length === 1 ? "" : "s"} need you` : undefined} />
        {loading && !data ? <Card><CardBody><SkeletonText /></CardBody></Card> : groups.length === 0 ? (
          <EmptyState icon={<Icons.Layers size={24} />} title="You haven't created a group yet" description="Set up your first savings group to start accepting applications." action={<LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton>} />
        ) : <NextActionList actions={actions} viewer="organizer" limit={8} emptyTitle="Nothing needs your attention" emptyDescription="All your groups are on track. Items appear here when members apply, contributions complete, or a group is ready to move forward." />}
      </section>
      {waiting.length > 0 && (
        <section className="section" aria-labelledby="org-waiting">
          <SectionHeader title={<span id="org-waiting">Waiting on members and Dhanvi</span>} description="No action from you yet." />
          <NextActionList actions={waiting} viewer="organizer" limit={6} />
        </section>
      )}
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
