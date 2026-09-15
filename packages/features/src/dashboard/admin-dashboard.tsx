"use client";
import Link from "next/link";
import { groupService, organizerService, paymentService, payoutService, contributionService } from "@dhanvi/api-client";
import type { MonthlyCycle } from "@dhanvi/types";
import { NextActionList, type WorkflowAction } from "../workflow";
import { useAsyncData, formatDate, formatMoney } from "@dhanvi/utils";
import { PageHeader, SectionHeader, StatCard, Card, CardBody, CardHeader, Callout, ErrorState, LinkButton, Icons, Avatar, CreatorTypeBadge, StatusBadge, SkeletonStats, SkeletonText } from "@dhanvi/ui";

const count = (status: string) => groupService.list("admin", `page=1&pageSize=1&status=${status}`).then((p) => p.totalCount);

export function AdminDashboard() {
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [recentGroups, active, recruiting, ready, full, suspended, pendingApps, underReview, approved, activeGroups, readyGroups, fullGroups, payments, payouts] = await Promise.all([
      groupService.list("admin", "page=1&pageSize=6"), count("ACTIVE"), count("RECRUITING"), count("READY_TO_START"), count("FULLY_SUBSCRIBED"), count("SUSPENDED"),
      organizerService.applications(1, 6, "PENDING"), organizerService.applications(1, 1, "UNDER_REVIEW"), organizerService.applications(1, 1, "APPROVED"),
      groupService.list("admin", "page=1&pageSize=50&status=ACTIVE"), groupService.list("admin", "page=1&pageSize=20&status=READY_TO_START"), groupService.list("admin", "page=1&pageSize=20&status=FULLY_SUBSCRIBED"),
      paymentService.list(true, 1).catch(() => null), payoutService.list(true, "page=1&pageSize=1").catch(() => null),
    ]);
    // Current cycles of active platform groups (bounded) — selection/payout attention derives from real cycle state.
    const platformActive = activeGroups.items.filter((g) => g.creatorType === "PLATFORM").slice(0, 10);
    const cycles = await Promise.all(platformActive.map(async (g) => ({ group: g, current: (await contributionService.cycles(g.id, "admin").catch(() => [] as MonthlyCycle[])).find((c) => c.cycleNumber === g.currentCycleNumber) })));
    return { recentGroups, active, recruiting, ready, full, suspended, pendingApps, underReview: underReview.totalCount, approved: approved.totalCount, readyGroups: readyGroups.items, fullGroups: fullGroups.items, cycles, payments, payouts: payouts?.summary ?? {} };
  }, []);
  if (error) return <div className="stack stack--lg"><PageHeader eyebrow="Administration" title="Platform overview" /><ErrorState message={error} onRetry={reload} /></div>;
  const pendingReview = (data?.pendingApps.totalCount ?? 0) + (data?.underReview ?? 0);
  const issues = pendingReview + (data?.ready ?? 0) + (data?.full ?? 0) + (data?.suspended ?? 0);
  const n = (k: string) => data?.payouts?.[k] ?? 0;
  const oldestApp = data?.pendingApps.items.length ? [...data.pendingApps.items].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0] : undefined;
  const attention: WorkflowAction[] = data ? [
    ...(pendingReview > 0 ? [{ id: "org-apps", title: `${pendingReview} organizer application${pendingReview === 1 ? "" : "s"} pending review`, description: "Applicants cannot create groups until approved.", status: "attention" as const, responsibleRole: "ADMIN" as const, since: oldestApp?.submittedAt, actionLabel: "Review applications", actionHref: "/organizers", priority: 10 }] : []),
    ...data.readyGroups.filter((g) => g.creatorType === "PLATFORM").map((g): WorkflowAction => ({ id: `ready-${g.id}`, title: `Activate ${g.name}`, description: `Platform group ready to start · first cycle from ${formatDate(g.startDate)}. Members are waiting for the schedule.`, status: "attention", responsibleRole: "ADMIN", actionLabel: "Activate", actionHref: `/groups/${g.id}`, priority: 5 })),
    ...data.fullGroups.filter((g) => g.creatorType === "PLATFORM").map((g): WorkflowAction => ({ id: `full-${g.id}`, title: `Confirm ${g.name} is ready`, description: "All positions reserved. Available once every member has accepted the rules.", status: "attention", responsibleRole: "ADMIN", actionLabel: "Open group", actionHref: `/groups/${g.id}`, priority: 12 })),
    ...data.cycles.filter((x) => x.current?.status === "READY_FOR_SELECTION").map(({ group, current }): WorkflowAction => ({ id: `sel-${group.id}`, title: `${current!.selectionMethod === "AUCTION" ? "Run the auction" : "Start the selection"} · ${group.name}`, description: `Cycle ${current!.cycleNumber} · all contributions complete. Members are waiting for the result.`, status: "attention", responsibleRole: "ADMIN", since: current!.readyForSelectionAt, actionLabel: current!.selectionMethod === "AUCTION" ? "Open auction" : "Run selection", actionHref: current!.selectionMethod === "AUCTION" ? `/groups/${group.id}/cycles/${current!.id}/auction` : `/groups/${group.id}?tab=cycles`, priority: 3 })),
    ...data.cycles.filter((x) => x.current?.status === "SELECTION_COMPLETED").map(({ group, current }): WorkflowAction => ({ id: `prep-${group.id}`, title: `Prepare payout settlement · ${group.name}`, description: `Cycle ${current!.cycleNumber} selection is complete; the winner is waiting for the payout.`, status: "attention", responsibleRole: "FINANCE", since: current!.selectionCompletedAt, actionLabel: "Open payouts", actionHref: `/payouts?groupId=${group.id}&cycleId=${current!.id}`, priority: 4 })),
    ...((data.payments?.reconciliationRequired ?? 0) > 0 ? [{ id: "pay-recon", title: `${data.payments!.reconciliationRequired} payment${data.payments!.reconciliationRequired === 1 ? "" : "s"} need reconciliation`, description: "Provider data did not match. Contributions stay unsettled until reviewed.", status: "blocked" as const, responsibleRole: "FINANCE" as const, actionLabel: "Review payments", actionHref: "/payments", priority: 1 }] : []),
    ...(n("RECONCILIATION_REQUIRED") > 0 ? [{ id: "po-recon", title: `${n("RECONCILIATION_REQUIRED")} payout${n("RECONCILIATION_REQUIRED") === 1 ? "" : "s"} with a reconciliation mismatch`, description: "Settlement and retries are blocked until reviewed.", status: "blocked" as const, responsibleRole: "FINANCE" as const, actionLabel: "Review payouts", actionHref: "/payouts", priority: 1 }] : []),
    ...(n("APPROVAL_REQUIRED") > 0 ? [{ id: "po-approve", title: `${n("APPROVAL_REQUIRED")} payout${n("APPROVAL_REQUIRED") === 1 ? "" : "s"} waiting for approval`, description: "Funding and beneficiary are ready; approve the destination to proceed.", status: "attention" as const, responsibleRole: "FINANCE" as const, actionLabel: "Review payouts", actionHref: "/payouts", priority: 6 }] : []),
    ...(n("APPROVED") > 0 ? [{ id: "po-exec", title: `${n("APPROVED")} approved payout${n("APPROVED") === 1 ? "" : "s"} ready to execute`, description: "Recipients are waiting for the transfer.", status: "attention" as const, responsibleRole: "FINANCE" as const, actionLabel: "Execute payouts", actionHref: "/payouts", priority: 6 }] : []),
    ...(n("FAILED") > 0 ? [{ id: "po-failed", title: `${n("FAILED")} failed payout${n("FAILED") === 1 ? "" : "s"}`, description: "The provider transfer failed and can be retried.", status: "attention" as const, responsibleRole: "FINANCE" as const, actionLabel: "Retry payouts", actionHref: "/payouts", priority: 2 }] : []),
    ...((data.suspended ?? 0) > 0 ? [{ id: "suspended", title: `${data.suspended} suspended group${data.suspended === 1 ? "" : "s"}`, description: "Contributions, selections and bids are paused for members.", status: "blocked" as const, responsibleRole: "ADMIN" as const, actionLabel: "Review groups", actionHref: "/groups", priority: 8 }] : []),
  ] : [];
  const waitingOnOthers: WorkflowAction[] = data ? [
    ...(n("PENDING_BENEFICIARY") > 0 ? [{ id: "po-acct", title: `${n("PENDING_BENEFICIARY")} payout${n("PENDING_BENEFICIARY") === 1 ? "" : "s"} waiting for a member bank account`, description: "Approval is unavailable until the recipient adds a payout account.", status: "waiting" as const, responsibleRole: "USER" as const, actionLabel: "View payouts", actionHref: "/payouts" }] : []),
    ...((n("PROCESSING") + n("PROVIDER_PENDING")) > 0 ? [{ id: "po-provider", title: `${n("PROCESSING") + n("PROVIDER_PENDING")} payout${n("PROCESSING") + n("PROVIDER_PENDING") === 1 ? "" : "s"} processing with the provider`, status: "waiting" as const, responsibleRole: "SYSTEM" as const, actionLabel: "View payouts", actionHref: "/payouts" }] : []),
    ...((data.payments?.pending ?? 0) > 0 ? [{ id: "pay-pending", title: `${data.payments!.pending} payment${data.payments!.pending === 1 ? "" : "s"} awaiting a verified capture`, description: "Razorpay verification is in progress; reconcile if it stays pending.", status: "waiting" as const, responsibleRole: "SYSTEM" as const, actionLabel: "View payments", actionHref: "/payments" }] : []),
    ...data.readyGroups.concat(data.fullGroups).filter((g) => g.creatorType !== "PLATFORM").map((g): WorkflowAction => ({ id: `org-${g.id}`, title: `${g.name} waiting for its organizer`, description: g.status === "READY_TO_START" ? "Ready to activate — the organizer starts the group." : "Fully subscribed — the organizer confirms readiness.", status: "waiting", responsibleRole: "ORGANIZER", actionLabel: "Inspect group", actionHref: `/groups/${g.id}` })),
  ] : [];
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Administration" title="Platform overview" description="What requires your action, what is waiting on others, and platform status." actions={<LinkButton href="/groups/create" variant="secondary" icon={<Icons.Plus size={16} />}>Create platform group</LinkButton>} />
      <section className="section" aria-labelledby="admin-attention">
        <SectionHeader title={<span id="admin-attention">Requires your attention</span>} description={attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"}` : undefined} />
        {loading && !data ? <SkeletonText /> : <NextActionList actions={attention} viewer="admin" limit={10} emptyTitle="Nothing requires your action" emptyDescription="You're all caught up. Applications, activations, selections, reconciliation and payout approvals appear here as they arise." />}
      </section>
      {waitingOnOthers.length > 0 && (
        <section className="section" aria-labelledby="admin-waiting">
          <SectionHeader title={<span id="admin-waiting">Waiting on members, organizers or providers</span>} description="No action from you yet." />
          <NextActionList actions={waitingOnOthers} viewer="admin" limit={6} />
        </section>
      )}
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
          <CardHeader title="Recent organizer applications" subtitle="Pending review" actions={<Link className="link text-sm" href="/organizers">Review queue →</Link>} />
          <CardBody>
            {loading && !data ? <SkeletonText /> : data?.pendingApps.items.length === 0 ? <p className="text-sm text-muted">No applications are waiting for review.</p> : (
              <div className="list">
                {data?.pendingApps.items.map((a) => (
                  <Link key={a.id} href="/organizers" className="list__item">
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
          <CardHeader title="Recent groups" actions={<Link className="link text-sm" href="/groups">All groups →</Link>} />
          <CardBody>
            {loading && !data ? <SkeletonText /> : data?.recentGroups.items.length === 0 ? <p className="text-sm text-muted">No groups have been created yet.</p> : (
              <div className="list">
                {data?.recentGroups.items.map((g) => (
                  <Link key={g.id} href={`/groups/${g.id}`} className="list__item">
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
