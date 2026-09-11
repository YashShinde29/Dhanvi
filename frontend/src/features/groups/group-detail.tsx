"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { groupService, type GroupScope } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import type { Member } from "@/types/group";
import { useAsyncData } from "@/hooks/use-async-data";
import { Guard, managementScope } from "./shared";
import { GroupWizard } from "./group-wizard";
import { ImportantRulesCard, RulesSnapshot } from "./group-rules-card";
import { GroupCreatorCard } from "./group-organizer-card";
import { MembershipCard } from "./group-membership-card";
import { GroupMembersTable, termsAccepted } from "./group-members-table";
import { GroupLifecycleActions } from "./group-actions";
import { CyclePanel } from "@/features/contributions/cycle-panel";
import { CreatorTypeBadge, GroupTypeBadge, StatusBadge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, ErrorState } from "@/components/ui/callout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tabs, TabPanel, type TabItem } from "@/components/ui/tabs";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Icons } from "@/components/ui/icons";
import { formatDate, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/status";

export function GroupDetailPage({ scope = "public", applications = false }: { scope?: GroupScope; applications?: boolean }) {
  return <Guard scope={scope}><GroupDetail scope={scope} applications={applications} /></Guard>;
}

function GroupDetail({ scope, applications }: { scope: GroupScope; applications: boolean }) {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const manage = managementScope(scope);
  const [tab, setTab] = useState(applications ? "applications" : "overview");
  const [editing, setEditing] = useState(false);

  const group = useAsyncData(() => groupService.details(id, scope), [id, scope, auth.user?.id]);
  const members = useAsyncData(() => groupService.members(id, scope), [id, scope], manage);
  const g = group.data;
  const cycles = useAsyncData(() => contributionService.cycles(id, scope as "admin" | "organizer"), [id, scope], manage && !!g?.activatedAt);

  async function refresh() { await Promise.all([group.reload(), manage ? members.reload() : Promise.resolve(), manage && g?.activatedAt ? cycles.reload() : Promise.resolve()]); }

  if (group.error) return <div className="stack"><Breadcrumbs items={[{ label: manage ? "My groups" : "Browse groups", href: manage ? `/${scope}/groups` : "/groups" }, { label: "Group" }]} /><ErrorState message={group.error} onRetry={group.reload} /></div>;
  if (!g) return <PageSkeleton />;

  const canManage = manage && (scope === "organizer" || g.creatorType === "PLATFORM");
  const memberRows: Member[] = members.data ?? [];
  const pendingApplications = manage ? memberRows.filter((m) => m.status === "APPLIED").length : g.pendingApplications;
  const termsPending = memberRows.filter((m) => m.status === "APPROVED" && !termsAccepted(m, g)).length;
  const activeMembers = memberRows.filter((m) => !["APPLIED", "REJECTED"].includes(m.status)).length;
  const currentCycle = cycles.data?.find((c) => c.cycleNumber === g.currentCycleNumber);
  const showCycles = !!g.activatedAt && (manage || g.myMembership?.status === "ACTIVE");
  const listHref = scope === "organizer" ? "/organizer/groups" : scope === "admin" ? "/admin/groups" : auth.authenticated && g.myMembership ? "/my-groups" : "/groups";
  const listLabel = scope === "organizer" ? "My groups" : scope === "admin" ? "Platform groups" : g.myMembership ? "My groups" : "Browse groups";

  const tabs: TabItem[] = manage
    ? [
        { id: "overview", label: "Overview" },
        { id: "applications", label: "Applications", count: pendingApplications, alert: true },
        { id: "members", label: "Members", count: activeMembers },
        ...(showCycles ? [{ id: "cycles", label: "Cycles" }] : []),
        { id: "rules", label: "Rules" },
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "rules", label: "Rules" },
        ...(showCycles ? [{ id: "cycles", label: "Cycles & contributions" }] : []),
      ];

  const full = g.currentMemberCount >= g.memberLimit;
  const memberProgress = (
    <Card>
      <CardHeader title="Member positions" subtitle={g.status === "READY_TO_START" ? "Ready to start" : full ? "Fully subscribed" : `${g.availableSlots} position${g.availableSlots === 1 ? "" : "s"} open`} />
      <CardBody>
        <ProgressBar value={g.currentMemberCount} max={g.memberLimit} label="Member positions filled" tone={full ? "indigo" : undefined}
          start={<strong className="num">{g.currentMemberCount} of {g.memberLimit} members joined</strong>} end={g.status === "READY_TO_START" ? <span className="badge badge--warning">Ready to start</span> : full ? <span className="badge badge--indigo">Fully subscribed</span> : undefined} />
      </CardBody>
    </Card>
  );

  return (
    <div className="stack stack--lg">
      <div className="group-hero">
        {scope === "admin" && <Link className="link" href={`/admin/ledger/groups/${id}`}>View group ledger</Link>}
        <Breadcrumbs items={[{ label: listLabel, href: listHref }, { label: g.name }]} />
        <div className="group-hero__top">
          <div className="group-hero__title">
            <div className="row"><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} />{manage && <CreatorTypeBadge creatorType={g.creatorType} />}</div>
            <h1 className="h-page">{g.name}</h1>
            <div className="group-hero__meta">
              <span className="row" style={{ gap: 6 }}><Icons.User size={14} /> {g.creatorType === "PLATFORM" ? "Dhanvi platform" : g.organizer?.name ?? "Organizer"}</span>
              <span className="row" style={{ gap: 6 }}><Icons.Calendar size={14} /> Starts {formatDate(g.startDate)}</span>
              {g.currentCycleNumber && <span className="row" style={{ gap: 6 }}><Icons.Activity size={14} /> Cycle {g.currentCycleNumber} of {g.durationMonths}</span>}
              <span className="row" style={{ gap: 6 }}><Icons.Globe size={14} /> {g.groupTimeZone}</span>
            </div>
            {g.description && <p className="text-secondary" style={{ maxWidth: 720 }}>{g.description}</p>}
          </div>
          {manage && !editing && <GroupLifecycleActions group={g} scope={scope} canManage={canManage} onChanged={refresh} onEdit={() => { setEditing(true); setTab("overview"); }} />}
        </div>
        {g.statusReason && <Callout variant={g.status === "CANCELLED" || g.status === "SUSPENDED" ? "warning" : "neutral"} title={`${statusLabel("group", g.status)} — reason`}>{g.statusReason}</Callout>}
        <div className="summary-strip" aria-label="Group summary">
          <div className="summary-strip__item"><span className="summary-strip__value amount">{formatMoney(g.groupValue)}</span><span className="summary-strip__label">Group value</span></div>
          <div className="summary-strip__item"><span className="summary-strip__value amount">{formatMoney(g.monthlyContribution)}</span><span className="summary-strip__label">Monthly contribution</span></div>
          <div className="summary-strip__item"><span className="summary-strip__value num">{g.currentMemberCount} / {g.memberLimit}</span><span className="summary-strip__label">Members joined</span></div>
          <div className="summary-strip__item"><span className="summary-strip__value num">{g.durationMonths} months</span><span className="summary-strip__label">Duration</span></div>
        </div>
      </div>

      {editing ? (
        <GroupWizard scope={scope} existing={g} onSaved={() => { setEditing(false); void refresh(); }} onCancel={() => setEditing(false)} />
      ) : (
        <>
          {manage && (
            <div className="grid-4">
              <button type="button" className={`attention${pendingApplications ? " attention--warning" : ""}`} onClick={() => setTab("applications")}>
                <span className="attention__count">{pendingApplications}</span>
                <span className="attention__text"><span className="attention__title">Pending applications</span><span className="attention__desc">{pendingApplications ? "Waiting for your review" : "Nothing to review"}</span></span>
              </button>
              <button type="button" className={`attention${termsPending ? " attention--info" : ""}`} onClick={() => setTab("members")}>
                <span className="attention__count">{termsPending}</span>
                <span className="attention__text"><span className="attention__title">Need rules acceptance</span><span className="attention__desc">{termsPending ? "Approved members yet to accept" : "All approved members accepted"}</span></span>
              </button>
              {currentCycle ? (
                <Link href={`/${scope}/groups/${g.id}/cycles/${currentCycle.id}/contributions`} className={`attention${currentCycle.pendingMemberCount ? " attention--info" : " attention--success"}`}>
                  <span className="attention__count num">{currentCycle.fullyRecordedMemberCount}<span className="text-muted" style={{ fontSize: "0.6em" }}> / {currentCycle.expectedMemberCount}</span></span>
                  <span className="attention__text"><span className="attention__title">Cycle {currentCycle.cycleNumber} contributions</span><span className="attention__desc">{formatMoney(currentCycle.recordedContributionAmount)} of {formatMoney(currentCycle.expectedPoolAmount)} recorded</span></span>
                </Link>
              ) : (
                <div className="attention"><span className="attention__count">—</span><span className="attention__text"><span className="attention__title">Contributions</span><span className="attention__desc">{g.activatedAt ? "Loading cycle…" : "Available after activation"}</span></span></div>
              )}
              {currentCycle && currentCycle.status === "READY_FOR_SELECTION" ? (
                <button type="button" className="attention attention--indigo" onClick={() => setTab("cycles")}>
                  <span className="attention__count"><Icons.Sparkle size={26} /></span>
                  <span className="attention__text"><span className="attention__title">{currentCycle.selectionMethod === "AUCTION" ? "Auction ready" : "Selection ready"}</span><span className="attention__desc">Cycle {currentCycle.cycleNumber} · all contributions recorded</span></span>
                </button>
              ) : (
                <div className={`attention${g.status === "READY_TO_START" || g.status === "FULLY_SUBSCRIBED" ? " attention--warning" : ""}`}>
                  <span className="attention__count"><Icons.Layers size={26} /></span>
                  <span className="attention__text"><span className="attention__title">{statusLabel("group", g.status)}</span><span className="attention__desc">{g.status === "READY_TO_START" ? "Activate to create the schedule" : g.status === "FULLY_SUBSCRIBED" ? "Confirm ready once rules are accepted" : g.status === "RECRUITING" ? `${g.availableSlots} positions open` : currentCycle ? `Cycle ${currentCycle.cycleNumber}: ${statusLabel("cycle", currentCycle.status)}` : "Group status"}</span></span>
                </div>
              )}
            </div>
          )}

          <Tabs items={tabs} value={tabs.some((t) => t.id === tab) ? tab : "overview"} onChange={setTab} label="Group sections" />

          <TabPanel id="overview" active={tab === "overview"}>
            {manage ? (
              <div className="grid-sidebar">
                <div className="stack stack--lg">{memberProgress}<ImportantRulesCard group={g} /></div>
                <div className="stack stack--lg"><GroupCreatorCard group={g} />{g.myMembership && <MembershipCard group={g} onChanged={refresh} />}</div>
              </div>
            ) : (
              <div className="grid-sidebar">
                <div className="stack stack--lg">{memberProgress}<ImportantRulesCard group={g} /></div>
                <div className="stack stack--lg"><MembershipCard group={g} onChanged={refresh} /><GroupCreatorCard group={g} /></div>
              </div>
            )}
          </TabPanel>
          <TabPanel id="rules" active={tab === "rules"}>
            <div className="grid-sidebar">
              <div className="stack stack--lg"><ImportantRulesCard group={g} /><RulesSnapshot group={g} /></div>
              <GroupCreatorCard group={g} />
            </div>
          </TabPanel>
          {manage && (
            <TabPanel id="applications" active={tab === "applications"}>
              {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : (
                <>
                  {g.status !== "RECRUITING" && pendingApplications > 0 && <Callout variant="neutral">Applications can only be approved while the group is recruiting.</Callout>}
                  <GroupMembersTable group={g} members={memberRows} scope={scope} canManage={canManage} mode="applications" onChanged={refresh} loading={members.loading && !members.data} />
                </>
              )}
            </TabPanel>
          )}
          {manage && (
            <TabPanel id="members" active={tab === "members"}>
              {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <GroupMembersTable group={g} members={memberRows} scope={scope} canManage={canManage} mode="members" onChanged={refresh} loading={members.loading && !members.data} />}
            </TabPanel>
          )}
          {showCycles && (
            <TabPanel id="cycles" active={tab === "cycles"}>
              <CyclePanel group={g} scope={scope} onChanged={refresh} />
            </TabPanel>
          )}
        </>
      )}
    </div>
  );
}
