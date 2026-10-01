"use client";
import Link from "next/link";
import { useAuth } from "@dhanvi/auth";
import { groupService, contributionService } from "@dhanvi/api-client";
import type { Group, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, greeting } from "@dhanvi/utils";
import { NextActionList, type WorkflowAction } from "../workflow";
import { PageHeader, SectionHeader, Card, CardBody, CardHeader, EmptyState, Callout, ErrorState, LinkButton, Icons, GroupTypeBadge, StatusBadge, SkeletonText } from "@dhanvi/ui";

/** Organizer home: what your own groups need from you, what they are waiting on, and a list of your groups. No platform data. */
export function OrganizerDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const page = await groupService.list("organizer", "page=1&pageSize=100");
    const active = page.items.filter((g) => g.status === "ACTIVE");
    const cycles = await Promise.all(active.slice(0, 8).map(async (g) => ({ group: g, current: (await contributionService.cycles(g.id, "organizer").catch(() => [] as MonthlyCycle[])).find((c) => c.cycleNumber === g.currentCycleNumber) })));
    return { groups: page.items, active, cycles };
  }, [user?.id]);
  if (error) return <div className="stack stack--lg"><PageHeader title={`${greeting()}, ${user?.firstName ?? ""}`} /><ErrorState message={error} onRetry={reload} /></div>;
  const groups: Group[] = data?.groups ?? [];
  const currentCycles = (data?.cycles ?? []).filter((x): x is { group: Group; current: MonthlyCycle } => !!x.current);
  const href = (g: Group, tab?: string) => `/organizer/groups/${g.id}${tab ? `?tab=${tab}` : ""}`;
  const actions: WorkflowAction[] = [
    ...groups.filter((g) => g.pendingApplications > 0).map((g): WorkflowAction => ({ id: `apps-${g.id}`, title: `Review ${g.pendingApplications} application${g.pendingApplications === 1 ? "" : "s"} · ${g.name}`, description: `${g.availableSlots} position${g.availableSlots === 1 ? "" : "s"} still open.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Review", actionHref: `/organizer/groups/${g.id}/applications`, priority: 10 })),
    ...groups.filter((g) => g.status === "FULLY_SUBSCRIBED").map((g): WorkflowAction => ({ id: `full-${g.id}`, title: `Confirm ${g.name} is ready`, description: "Available once every approved member has accepted the rules.", status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Open group", actionHref: href(g), priority: 12 })),
    ...groups.filter((g) => g.status === "READY_TO_START").map((g): WorkflowAction => ({ id: `ready-${g.id}`, title: `Activate ${g.name}`, description: `First cycle from ${formatDate(g.startDate)}.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Open group", actionHref: href(g), priority: 5 })),
    ...currentCycles.filter((x) => x.current.status === "READY_FOR_SELECTION").map(({ group, current }): WorkflowAction => ({ id: `sel-${group.id}`, title: `${current.selectionMethod === "AUCTION" ? "Run the auction" : "Start the selection"} · ${group.name}`, description: `Cycle ${current.cycleNumber} · all contributions are complete.`, status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Open group", actionHref: href(group), priority: 3 })),
    ...currentCycles.filter((x) => x.current.status === "COLLECTING_CONTRIBUTIONS" && x.current.collectionMode !== "RAZORPAY" && x.current.pendingMemberCount > 0).map(({ group, current }): WorkflowAction => ({ id: `rec-${group.id}`, title: `Record ${current.pendingMemberCount} outstanding contribution${current.pendingMemberCount === 1 ? "" : "s"} · ${group.name}`, description: `Cycle ${current.cycleNumber} · due ${formatDate(current.contributionDueDate)} · ${formatMoney(current.recordedContributionAmount)} of ${formatMoney(current.expectedPoolAmount)} recorded.`, status: "current", responsibleRole: "ORGANIZER", actionLabel: "Record", actionHref: href(group, "contributions"), priority: 20 })),
    ...groups.filter((g) => g.status === "DRAFT").map((g): WorkflowAction => ({ id: `draft-${g.id}`, title: `Publish ${g.name}`, description: "Saved as a draft. Members cannot see it until you publish.", status: "current", responsibleRole: "ORGANIZER", actionLabel: "Open group", actionHref: href(g), priority: 30 })),
  ];
  const waiting: WorkflowAction[] = [
    ...groups.filter((g) => g.status === "RECRUITING" && g.pendingApplications === 0 && g.availableSlots > 0).map((g): WorkflowAction => ({ id: `wait-fill-${g.id}`, title: `${g.name} · waiting for ${g.availableSlots} more member${g.availableSlots === 1 ? "" : "s"}`, description: `${g.currentMemberCount} of ${g.memberLimit} positions filled.`, status: "waiting", responsibleRole: "USER", actionLabel: "View group", actionHref: href(g) })),
    ...currentCycles.filter((x) => x.current.status === "SELECTION_COMPLETED" || x.current.status === "PAYOUT_PENDING").map(({ group, current }): WorkflowAction => ({ id: `wait-payout-${group.id}`, title: `${group.name} · cycle ${current.cycleNumber} payout with Dhanvi`, description: "Dhanvi prepares and processes the payout.", status: "waiting", responsibleRole: "ADMIN", actionLabel: "Payout status", actionHref: href(group, "payouts") })),
  ];
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer" title={`${greeting()}, ${user?.firstName ?? ""}`} description="What your groups need from you, and what they are waiting on." />
      {user?.organizerStatus === "SUSPENDED" && <Callout variant="warning" title="Organizer access suspended">You can view your groups but cannot create or operate them while suspended.</Callout>}
      <section className="section" aria-labelledby="org-actions">
        <SectionHeader title={<span id="org-actions">Actions required</span>} description={actions.length ? `${actions.length} item${actions.length === 1 ? " needs" : "s need"} you` : undefined} />
        {loading && !data ? <Card><CardBody><SkeletonText /></CardBody></Card> : groups.length === 0 ? (
          <EmptyState icon={<Icons.Layers size={24} />} title="You haven't created a group yet" description="Set up your first savings group to start accepting applications." action={<LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton>} />
        ) : <NextActionList actions={actions} viewer="organizer" limit={8} emptyTitle="Nothing needs you" emptyDescription="All your groups are on track. Items appear here when members apply, contributions complete or a group is ready to move forward." />}
      </section>
      {waiting.length > 0 && (
        <section className="section" aria-labelledby="org-waiting">
          <SectionHeader title={<span id="org-waiting">Waiting for members and Dhanvi</span>} description="No action from you." />
          <NextActionList actions={waiting} viewer="organizer" limit={6} />
        </section>
      )}
      {groups.length > 0 && (
        <Card>
          <CardHeader title="My groups" actions={<Link className="link text-sm" href="/organizer/groups">All groups →</Link>} />
          <CardBody>
            <div className="list">
              {groups.slice(0, 6).map((g) => (
                <Link key={g.id} href={href(g)} className="list__item">
                  <span className="list__text"><span className="list__title">{g.name}</span><span className="list__desc">{formatMoney(g.groupValue)} · {g.currentMemberCount}/{g.memberLimit} members · {g.currentCycleNumber ? `cycle ${g.currentCycleNumber} of ${g.durationMonths}` : `starts ${formatDate(g.startDate)}`}</span></span>
                  <span className="row" style={{ gap: 6 }}><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} /></span>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
