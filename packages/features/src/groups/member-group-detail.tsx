"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@dhanvi/auth";
import { groupService, contributionService, payoutService } from "@dhanvi/api-client";
import type { Contribution, Group, MonthlyCycle } from "@dhanvi/types";
import { useAsyncData, formatDate, formatMoney, formatMonthlyDay, statusGuidance, statusLabel } from "@dhanvi/utils";
import { GroupTypeBadge, StatusBadge, Breadcrumbs, Button, LinkButton, Card, CardBody, CardHeader, Callout, Checkbox, ControlPanel, DataTable, type Column, ErrorState, FactStrip, ProgressBar, RuleList, Tabs, TabPanel, type TabItem, PageSkeleton, Icons, useConfirm, useToast } from "@dhanvi/ui";
import { friendlyError } from "@dhanvi/utils";
import { ImportantRulesCard, RulesSnapshot } from "./group-rules-card";
import { GroupCreatorCard } from "./group-organizer-card";
import { MemberCyclePanel } from "../contributions/cycle-panel";
import { CycleScheduleTable } from "../contributions/cycle-progress";
import { PaymentCheckout } from "../payments/payment-checkout";
import { CyclePayoutStatus } from "../payouts/cycle-settlement";
import { AuctionSummaryCard } from "../auctions/auction-summary-card";
import { SelectionPanel } from "../selections/selection-panel";
import { StickyActionBar, termsCurrent } from "../workflow";
import { useTabParam } from "../layout/use-tab";

const MEMBER_TABS = ["overview", "contribution", "schedule", "selection", "payout", "rules"] as const;

/**
 * Member portal group page. Answers "what group is this, where does it stand, and what do I need to do?" — one status
 * card with at most one primary action, then member-relevant tabs. No operational or platform information.
 */
export function MemberGroupDetail({ scope }: { scope: "public" | "mine" }) {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const [tabRaw, setTab] = useTabParam("overview", MEMBER_TABS);
  const group = useAsyncData(() => groupService.details(id, scope), [id, scope, auth.user?.id]);
  const g = group.data;
  const membership = g?.myMembership?.status;
  const canSeeCycles = !!g?.activatedAt && (membership === "ACTIVE" || membership === "COMPLETED" || membership === "APPROVED");
  const cycles = useAsyncData(() => contributionService.cycles(id), [id], canSeeCycles);
  const mine = useAsyncData(() => contributionService.myGroup(id), [id], canSeeCycles);
  const payouts = useAsyncData(() => payoutService.list(false, "page=1"), [id], canSeeCycles);
  async function refresh() { await Promise.all([group.reload(), canSeeCycles ? cycles.reload() : Promise.resolve(), canSeeCycles ? mine.reload() : Promise.resolve()]); }

  if (group.error) return <div className="stack"><Breadcrumbs items={[{ label: "Browse groups", href: "/groups" }, { label: "Group" }]} /><ErrorState message={group.error} onRetry={group.reload} /></div>;
  if (!g) return <PageSkeleton />;

  const currentCycle = cycles.data?.find((c) => c.cycleNumber === g.currentCycleNumber);
  const own = mine.data?.find((c) => c.cycleId === currentCycle?.id);
  const financial = own?.collectionMode === "RAZORPAY";
  const ownSettled = !!own && (own.status === "RECORDED" || own.financialStatus.toUpperCase() === "SETTLED");
  const payDue = own && !ownSettled && financial && currentCycle?.status === "COLLECTING_CONTRIBUTIONS" ? own.expectedAmount - own.financiallySettledAmount : null;
  const listHref = auth.authenticated && g.myMembership ? "/my-groups" : "/groups";
  const full = g.currentMemberCount >= g.memberLimit;
  const tabs: TabItem[] = [
    { id: "overview", label: "Overview" },
    ...(canSeeCycles ? [{ id: "contribution", label: "My contribution" }, { id: "schedule", label: "Schedule" }, { id: "selection", label: g.groupType === "AUCTION" ? "Auction" : "Selection" }, { id: "payout", label: "Payout" }] : []),
    { id: "rules", label: "Rules" },
  ];
  const activeTab = tabs.some((t) => t.id === tabRaw) ? tabRaw : "overview";

  return (
    <div className={`stack stack--lg${payDue ? " has-sticky-action" : ""}`}>
      <div className="group-hero">
        <Breadcrumbs items={[{ label: g.myMembership ? "My groups" : "Browse groups", href: listHref }, { label: g.name }]} />
        <div className="group-hero__title">
          <div className="row"><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} />{g.myMembership && <StatusBadge kind="membership" value={g.myMembership.status} />}</div>
          <h1 className="h-page">{g.name}</h1>
          {g.description && <p className="text-secondary" style={{ maxWidth: 720, margin: 0 }}>{g.description}</p>}
        </div>
        <FactStrip label="Group summary" items={[
          { label: "Group value", value: <span className="amount">{formatMoney(g.groupValue)}</span> },
          { label: "Monthly contribution", value: <span className="amount">{formatMoney(g.monthlyContribution)}</span> },
          { label: "Current cycle", value: g.currentCycleNumber ? `${g.currentCycleNumber} of ${g.durationMonths}` : `Starts ${formatDate(g.startDate)}` },
          { label: "Members", value: `${g.currentMemberCount} of ${g.memberLimit}` },
          { label: "Type", value: g.groupType === "AUCTION" ? "Auction" : "Random draw" },
          { label: "Organizer", value: g.creatorType === "PLATFORM" ? "Dhanvi" : g.organizer?.name ?? "Organizer" },
        ]} />
      </div>

      <MemberStatusCard group={g} currentCycle={currentCycle} own={own} onChanged={refresh} />
      {currentCycle?.selectionMethod === "AUCTION" && ["READY_FOR_SELECTION", "CONTRIBUTIONS_COMPLETE", "SELECTION_COMPLETED", "PAYOUT_PENDING"].includes(currentCycle.status) && activeTab === "overview" && <AuctionSummaryCard group={g} cycle={currentCycle} href={`/groups/${g.id}/cycles/${currentCycle.id}/auction`} viewer="member" />}
      {payDue !== null && own && <StickyActionBar title={`Cycle ${currentCycle?.cycleNumber} contribution due`} amount={payDue} href={`/contributions?groupId=${g.id}`} label="Pay now" />}

      <Tabs items={tabs} value={activeTab} onChange={setTab} label="Group sections" />
      <TabPanel id="overview" active={activeTab === "overview"}>
        <div className="grid-sidebar">
          <div className="stack stack--lg">
            <Card>
              <CardHeader title="Member progress" subtitle={g.status === "READY_TO_START" ? "Ready to start" : full ? "Fully subscribed" : `${g.availableSlots} position${g.availableSlots === 1 ? "" : "s"} open`} />
              <CardBody><ProgressBar value={g.currentMemberCount} max={g.memberLimit} label="Member positions filled" tone={full ? "indigo" : undefined} start={<strong className="num">{g.currentMemberCount} of {g.memberLimit} members joined</strong>} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="How this group works" />
              <CardBody><RuleList items={[
                { key: "Duration", value: `${g.durationMonths} months` }, { key: "Contribution date", value: formatMonthlyDay(g.contributionDueDay) },
                { key: g.groupType === "AUCTION" ? "Auction date" : "Selection date", value: formatMonthlyDay(g.selectionDay) }, { key: "Payout date", value: formatMonthlyDay(g.payoutDay) },
                { key: "First payout", value: g.organizerFirstPayout ? "Organizer reserved (cycle 1)" : g.groupType === "AUCTION" ? "Auction" : "Random draw" }, { key: "Start date", value: formatDate(g.startDate) },
              ]} /><p className="text-sm text-secondary" style={{ marginTop: 12, marginBottom: 0 }}>Each member receives the main payout once and keeps contributing for every remaining cycle. Full rules are under the Rules tab.</p></CardBody>
            </Card>
          </div>
          <GroupCreatorCard group={g} />
        </div>
      </TabPanel>
      {canSeeCycles && (
        <>
          <TabPanel id="contribution" active={activeTab === "contribution"}>
            <MyGroupContributions group={g} contributions={mine.data ?? []} loading={mine.loading && !mine.data} />
          </TabPanel>
          <TabPanel id="schedule" active={activeTab === "schedule"}>
            {cycles.error ? <ErrorState message={cycles.error} onRetry={cycles.reload} /> : cycles.data ? <MemberCyclePanel group={g} cycles={cycles.data} mine={mine.data ?? []} scope={scope} /> : <PageSkeleton />}
            {cycles.data && <div className="section"><div className="section__header"><h2 className="h-section">Full schedule</h2></div><CycleScheduleTable group={g} cycles={cycles.data} scope={scope} mine={mine.data ?? []} /></div>}
          </TabPanel>
          <TabPanel id="selection" active={activeTab === "selection"}>
            {currentCycle ? (currentCycle.selectionMethod === "AUCTION" ? <AuctionSummaryCard group={g} cycle={currentCycle} href={`/groups/${g.id}/cycles/${currentCycle.id}/auction`} viewer="member" /> : <SelectionPanel group={g} cycle={currentCycle} viewer="member" />) : <Callout variant="neutral">{g.status === "COMPLETED" ? "All cycles are complete." : "The selection appears once the group starts."}</Callout>}
          </TabPanel>
          <TabPanel id="payout" active={activeTab === "payout"}>
            {currentCycle?.selectionResultId ? <CyclePayoutStatus cycleId={currentCycle.id} groupId={g.id} scope={scope} /> : <Callout variant="neutral" title="No payout yet">{g.myMembership?.hasBeenSelectedForPayout ? `You received the cycle ${g.myMembership.payoutCycleNumber} payout right. Earlier payouts are listed under Payouts.` : "Your payout appears here when you are selected. Every member receives the main payout once."}</Callout>}
            <div className="row"><Link className="link" href="/payouts">All my payouts</Link>{payouts.data && payouts.data.items.some((p) => p.groupId === g.id) && <span className="text-sm text-muted">· {payouts.data.items.filter((p) => p.groupId === g.id).length} for this group</span>}</div>
          </TabPanel>
        </>
      )}
      <TabPanel id="rules" active={activeTab === "rules"}>
        <div className="grid-sidebar"><div className="stack stack--lg"><ImportantRulesCard group={g} /><RulesSnapshot group={g} /></div><GroupCreatorCard group={g} /></div>
      </TabPanel>
    </div>
  );
}

/** "Your status": what the member must do next, with at most one primary action. */
function MemberStatusCard({ group: g, currentCycle, own, onChanged }: { group: Group; currentCycle?: MonthlyCycle; own?: Contribution; onChanged: () => Promise<void> }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const m = g.myMembership;
  const organizer = g.creatorType === "PLATFORM" ? "Dhanvi" : g.organizer?.name ?? "the organizer";

  async function apply() {
    const r = await confirm({ title: `Apply to join ${g.name}?`, description: `Your application goes to ${organizer} for review. No money is collected now.`, confirmLabel: "Submit application",
      details: <RuleList items={[{ key: "Monthly contribution", value: formatMoney(g.monthlyContribution) }, { key: "Duration", value: `${g.durationMonths} months` }, { key: "Contribution date", value: formatMonthlyDay(g.contributionDueDay) }]} /> });
    if (!r.confirmed) return;
    setBusy(true);
    try { await groupService.action(`groups/${g.id}/applications`); toast.success("Application submitted ✓", `Waiting for: ${organizer} to review it. No action is required from you.`); await onChanged(); }
    catch (f) { toast.error("Application not submitted", friendlyError(f)); } finally { setBusy(false); }
  }
  async function acceptRules() {
    if (!g.currentRules || !accepted) return;
    setBusy(true);
    try { await groupService.action(`groups/${g.id}/accept-terms`, { groupRuleVersionId: g.currentRules.id, rulesHash: g.currentRules.rulesHash }); toast.success("Rules accepted ✓", "Next: the group starts once every position is filled and confirmed."); setShowRules(false); setAccepted(false); await onChanged(); }
    catch (f) { toast.error("Rules not accepted", friendlyError(f)); } finally { setBusy(false); }
  }

  type View = { stage: string; status: "attention" | "waiting" | "current" | "complete" | "blocked" | "upcoming"; headline: string; facts?: { label: string; value: string; tone?: "blocked" | "waiting" }[]; primary?: React.ReactNode; body?: React.ReactNode };
  let v: View;
  if (!auth.authenticated) v = { stage: g.status === "RECRUITING" ? "Positions open" : statusLabel("group", g.status), status: "current", headline: g.status === "RECRUITING" ? `${g.availableSlots} of ${g.memberLimit} positions are open. Sign in to apply; no money is collected now.` : "This group is not accepting applications.", primary: g.status === "RECRUITING" ? <LinkButton href={`/login?returnUrl=${encodeURIComponent(`/groups/${g.id}`)}`}>Sign in to apply</LinkButton> : undefined };
  else if (!m) v = g.status === "RECRUITING"
    ? { stage: "Apply for a position", status: "current", headline: `${g.availableSlots} of ${g.memberLimit} positions open · ${formatMoney(g.monthlyContribution)} per month.`, facts: [{ label: "Next", value: `${organizer} reviews your application.` }], primary: <Button loading={busy} onClick={apply} icon={<Icons.Send size={16} />}>Apply to join</Button> }
    : { stage: "Not a member", status: "upcoming", headline: "This group is not accepting applications." };
  else if (m.status === "APPLIED") v = { stage: "Application submitted", status: "waiting", headline: `Submitted ${formatDate(m.appliedAt)}.`, facts: [{ label: "Waiting for", value: `${organizer} to review your application`, tone: "waiting" }, { label: "Next", value: "After approval you review and accept the group rules." }] };
  else if (m.status === "APPROVED" && g.currentRules && !termsCurrent(m, g) && ["RECRUITING", "FULLY_SUBSCRIBED"].includes(g.status)) v = {
    stage: "Action required · accept the rules", status: "attention", headline: "Your membership was approved. Review and accept the rules to hold your position.",
    facts: [{ label: "Next", value: "Once every member accepts, the group is confirmed and starts on its start date." }],
    primary: showRules ? undefined : <Button onClick={() => setShowRules(true)} icon={<Icons.FileText size={16} />}>Review &amp; accept rules</Button>,
    body: showRules ? (
      <div className="stack" style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 12 }}>
        <div className="text-strong">Group rules · Version {g.rulesVersion}</div>
        <RuleList items={[{ key: "Monthly contribution", value: formatMoney(g.monthlyContribution) }, { key: "Duration", value: `${g.durationMonths} months` }, { key: "Group value", value: formatMoney(g.groupValue) }, { key: "First payout", value: g.organizerFirstPayout ? "Organizer reserved (cycle 1)" : g.groupType === "AUCTION" ? "Auction" : "Random draw" }, { key: "Start date", value: formatDate(g.startDate) }, { key: "Contribution date", value: formatMonthlyDay(g.contributionDueDay) }, { key: "Payout date", value: formatMonthlyDay(g.payoutDay) }]} />
        <p className="text-sm text-secondary">Each member receives the main payout once and keeps contributing for all remaining cycles. The full snapshot and hash are under the Rules tab.</p>
        <Checkbox checked={accepted} onChange={setAccepted} label="I have reviewed and agree to these group rules." />
        <div className="row"><Button disabled={!accepted} loading={busy} onClick={acceptRules} icon={<Icons.Check size={16} />}>Accept rules</Button><Button variant="ghost" onClick={() => setShowRules(false)}>Not now</Button></div>
      </div>
    ) : undefined,
  };
  else if (m.status === "APPROVED") v = { stage: "You're in", status: "waiting", headline: g.status === "READY_TO_START" ? `The group starts ${formatDate(g.startDate)}.` : g.availableSlots > 0 ? `Waiting for ${g.availableSlots} more member${g.availableSlots === 1 ? "" : "s"} to join.` : `Waiting for ${organizer} to confirm and start the group.`, facts: [{ label: "Waiting for", value: g.availableSlots > 0 ? "remaining positions to fill" : `${organizer} to start the group`, tone: "waiting" }, { label: "Next", value: "Your first contribution becomes due when the group starts." }] };
  else if (m.status === "REJECTED") v = { stage: "Application not approved", status: "blocked", headline: m.rejectedReason || `${organizer} did not approve this application.` };
  else if (m.status === "COMPLETED" || g.status === "COMPLETED") v = { stage: "Group completed", status: "complete", headline: "This group finished all of its cycles. No further contributions are required." };
  else if (g.status === "SUSPENDED") v = { stage: "Group paused", status: "blocked", headline: "Dhanvi has paused this group. No contribution is due until it resumes.", facts: [{ label: "Waiting for", value: "Dhanvi to resume the group", tone: "waiting" }] };
  else if (!currentCycle) v = { stage: "Active member", status: "current", headline: m.slotNumber ? `You hold position #${m.slotNumber}.` : "You are an active member." };
  else {
    const c = currentCycle; const financial = c.collectionMode === "RAZORPAY";
    const settled = !!own && (own.status === "RECORDED" || own.financialStatus.toUpperCase() === "SETTLED");
    const remaining = c.expectedMemberCount - (financial ? c.financiallySettledMemberCount : c.fullyRecordedMemberCount);
    if (c.status === "COLLECTING_CONTRIBUTIONS" && own && !settled) {
      const due = own.expectedAmount - (financial ? own.financiallySettledAmount : own.recordedAmount);
      v = financial
        ? { stage: `Pay your cycle ${c.cycleNumber} contribution`, status: own.status === "OVERDUE" ? "blocked" : "attention", headline: `${formatMoney(due)} due ${formatDate(own.dueDate)}${own.status === "OVERDUE" ? " · overdue" : ""}.`, body: <PaymentCheckout contributionId={own.id} groupName={g.name} cycleNumber={c.cycleNumber} dueDate={own.dueDate} /> }
        : { stage: `Cycle ${c.cycleNumber} contribution due`, status: own.status === "OVERDUE" ? "blocked" : "attention", headline: `Pay ${formatMoney(due)} to ${organizer} by ${formatDate(own.dueDate)}. They record it here.`, facts: [{ label: "Next", value: "Once every member has contributed, the selection runs." }] };
    } else if (c.status === "COLLECTING_CONTRIBUTIONS") v = { stage: "Contribution complete ✓", status: "waiting", headline: `You're all caught up for cycle ${c.cycleNumber}.`, facts: [{ label: "Waiting for", value: `${remaining} other member${remaining === 1 ? "" : "s"} to complete their contributions`, tone: "waiting" }, { label: "Next", value: `The ${c.selectionMethod === "AUCTION" ? "auction" : "selection"} runs once everyone has contributed.` }] };
    else if (c.status === "READY_FOR_SELECTION" || c.status === "CONTRIBUTIONS_COMPLETE") v = c.selectionMethod === "AUCTION"
      ? { stage: `Cycle ${c.cycleNumber} auction`, status: "current", headline: `All contributions are complete. The auction runs on ${formatDate(c.selectionDate)}; bidding happens on the dedicated auction screen.`, primary: <LinkButton href={`/groups/${g.id}/cycles/${c.id}/auction`} icon={<Icons.Gavel size={16} />}>Enter auction</LinkButton> }
      : { stage: "Waiting for the selection", status: "waiting", headline: `All cycle ${c.cycleNumber} contributions are complete.`, facts: [{ label: "Waiting for", value: `${organizer} to start the selection`, tone: "waiting" }, { label: "Next", value: "You see the result here as soon as it runs." }] };
    else if (c.status === "SELECTION_COMPLETED" || c.status === "PAYOUT_PENDING") v = m.hasBeenSelectedForPayout && m.payoutCycleNumber === c.cycleNumber
      ? { stage: "You were selected 🎉", status: "complete", headline: `You hold the cycle ${c.cycleNumber} payout right.`, facts: [{ label: "Next", value: "Dhanvi processes your payout. Add a payout bank account under Payouts if you haven't." }] }
      : { stage: `Cycle ${c.cycleNumber} selection complete`, status: "waiting", headline: "Another member was selected this cycle. Keep contributing; your turn comes in a later cycle.", facts: [{ label: "Waiting for", value: "the payout to settle, then the next cycle opens", tone: "waiting" }] };
    else v = { stage: `Cycle ${c.cycleNumber} · ${statusGuidance("cycle", c.status).stage}`, status: "current", headline: statusGuidance("cycle", c.status).description };
  }
  return (
    <ControlPanel eyebrow="Your status" stage={v.stage} status={v.status} headline={v.headline} facts={v.facts} primary={v.primary}>
      {v.body}
      {!v.primary && !v.body && (v.status === "waiting" || v.status === "complete") && <p className="wf-noaction" role="status" style={{ margin: 0 }}>No action is required from you.</p>}
    </ControlPanel>
  );
}

function MyGroupContributions({ group, contributions, loading }: { group: Group; contributions: Contribution[]; loading: boolean }) {
  const columns: Column<Contribution>[] = [
    { key: "cycle", header: "Cycle", primary: true, render: (c) => <span className="text-strong">Cycle {c.cycleNumber}{c.cycleNumber === group.currentCycleNumber ? <span className="badge badge--success badge--plain" style={{ marginLeft: 8 }}>Current</span> : null}</span> },
    { key: "due", header: "Due", render: (c) => formatDate(c.dueDate) },
    { key: "amount", header: "Amount", align: "right", render: (c) => <span className="amount">{formatMoney(c.expectedAmount)}</span> },
    { key: "paid", header: "Paid", align: "right", render: (c) => <span className="amount">{formatMoney(c.collectionMode === "RAZORPAY" ? c.financiallySettledAmount : c.recordedAmount)}</span> },
    { key: "status", header: "Status", render: (c) => c.collectionMode === "RAZORPAY" ? <StatusBadge kind="contribution" value={c.financialStatus.toUpperCase() === "SETTLED" ? "RECORDED" : c.status} /> : <StatusBadge kind="contribution" value={c.status} /> },
  ];
  return (
    <div className="stack">
      <DataTable columns={columns} rows={loading ? undefined : contributions} loading={loading} rowKey={(c) => c.id} caption="My contributions in this group" empty={{ title: "No contributions yet", description: "Your monthly contributions appear here once the group starts." }} />
      <p className="text-sm text-muted">Pay a due contribution from <Link className="link" href={`/contributions?groupId=${group.id}`}>Contributions</Link> or from the status card above.</p>
    </div>
  );
}
