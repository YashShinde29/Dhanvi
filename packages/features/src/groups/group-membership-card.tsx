"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@dhanvi/auth";
import { groupService } from "@dhanvi/api-client";
import type { Group } from "@dhanvi/types";
import { StatusBadge, Button, LinkButton, Callout, Card, CardBody, CardHeader, Checkbox, Icons, useToast, useConfirm, RuleList } from "@dhanvi/ui";
import { WorkflowStatusCard, membershipSummary } from "../workflow";
import { friendlyError, formatDate, formatMoney, formatMonthlyDay } from "@dhanvi/utils";

export function MembershipCard({ group, onChanged }: { group: Group; onChanged: () => Promise<void> }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const own = group.myMembership;
  const organizerName = group.creatorType === "PLATFORM" ? "Dhanvi" : group.organizer?.name ?? "the organizer";

  async function apply() {
    const result = await confirm({
      title: `Apply to join ${group.name}?`,
      description: `Your application will be sent to ${organizerName} for review.`,
      details: <RuleList items={[{ key: "Monthly contribution", value: formatMoney(group.monthlyContribution) }, { key: "Duration", value: `${group.durationMonths} months` }, { key: "Contribution date", value: formatMonthlyDay(group.contributionDueDay) }]} />,
      confirmLabel: "Submit application",
    });
    if (!result.confirmed) return;
    setBusy(true);
    try { await groupService.action(`groups/${group.id}/applications`); toast.success("Application submitted ✓", `Next: ${organizerName} reviews it. No action is required from you.`); await onChanged(); }
    catch (failure) { toast.error("Application not submitted", friendlyError(failure)); }
    finally { setBusy(false); }
  }

  async function acceptRules() {
    if (!group.currentRules || !accepted) return;
    setBusy(true);
    try {
      await groupService.action(`groups/${group.id}/accept-terms`, { groupRuleVersionId: group.currentRules.id, rulesHash: group.currentRules.rulesHash });
      toast.success("Rules accepted ✓", "Next: the group starts once every position is filled and the organizer confirms.");
      setAccepted(false);
      await onChanged();
    } catch (failure) { toast.error("Rules not accepted", friendlyError(failure)); }
    finally { setBusy(false); }
  }

  if (!auth.authenticated) {
    return (
      <Card>
        <CardBody className="stack">
          <div className="text-strong">Interested in this group?</div>
          <p className="text-sm text-secondary">Sign in or create an account to apply. No money is collected at this stage.</p>
          <LinkButton href={`/login?returnUrl=${encodeURIComponent(`/groups/${group.id}`)}`} block>Sign in to apply</LinkButton>
          <Link href="/register" className="link text-sm" style={{ textAlign: "center" }}>Create an account</Link>
        </CardBody>
      </Card>
    );
  }

  const termsCurrent = !!own?.termsAcceptedAt && own.termsVersionId === group.currentRules?.id;
  const needsTerms = own?.status === "APPROVED" && !!group.currentRules && !termsCurrent && ["RECRUITING", "FULLY_SUBSCRIBED"].includes(group.status);
  const summary = membershipSummary(group);
  if (summary.action && needsTerms) summary.action = { ...summary.action, onAction: () => setShowRules(true) };
  if (!own && group.status === "RECRUITING") summary.action = { title: "Apply for a position", description: `${group.availableSlots} of ${group.memberLimit} positions open · applying is free and reversible until approval.`, status: "current", responsibleRole: "USER", actionLabel: "Apply to join", onAction: apply };

  return (
    <Card>
      <CardHeader title="Membership" subtitle={organizerName === "Dhanvi" ? "Platform group" : `Organized by ${organizerName}`} actions={own && <StatusBadge kind="membership" value={own.status} />} />
      <CardBody className="stack stack--lg">
        <WorkflowStatusCard summary={summary} viewer="member" title="Your membership" stepperLabel="Membership steps" bare />
        {!own && group.status === "RECRUITING" && <Button block loading={busy} onClick={apply} icon={<Icons.Send size={16} />}>Apply to join</Button>}
        {own?.hasBeenSelectedForPayout && <Callout variant="success" title={`Selected for the cycle ${own.payoutCycleNumber} payout right`}>This records your payout turn. It does not confirm a money transfer.</Callout>}
        {needsTerms && (
          <div className="stack">
            <Callout variant="warning" title="Rules acceptance required">Review and accept group rules version {group.rulesVersion} before the group can start.</Callout>
            {!showRules ? <Button variant="secondary" onClick={() => setShowRules(true)} icon={<Icons.FileText size={16} />}>Review rules</Button> : (
              <div className="stack" style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 12 }}>
                <div className="text-strong">Group rules · Version {group.rulesVersion}</div>
                <RuleList items={[
                  { key: "Monthly contribution", value: formatMoney(group.monthlyContribution) },
                  { key: "Duration", value: `${group.durationMonths} months` },
                  { key: "Group value", value: formatMoney(group.groupValue) },
                  { key: "First payout", value: group.organizerFirstPayout ? "Organizer reserved (cycle 1)" : group.groupType === "AUCTION" ? "Auction" : "Random draw" },
                  { key: "Start date", value: formatDate(group.startDate) },
                  { key: "Contribution date", value: formatMonthlyDay(group.contributionDueDay) },
                  { key: group.groupType === "AUCTION" ? "Auction date" : "Selection date", value: formatMonthlyDay(group.selectionDay) },
                  { key: "Payout date", value: formatMonthlyDay(group.payoutDay) },
                ]} />
                <p className="text-sm text-secondary">Each member receives the main payout once and must keep contributing for all remaining cycles. The full published snapshot and hash are available under the Rules tab.</p>
                <Checkbox checked={accepted} onChange={setAccepted} label="I have reviewed and agree to these group rules." />
                <Button block disabled={!accepted} loading={busy} onClick={acceptRules} icon={<Icons.Check size={16} />}>Accept rules</Button>
              </div>
            )}
          </div>
        )}
        {own?.status === "ACTIVE" && <p className="text-sm text-secondary">Track your contributions under the Cycle progress tab.</p>}
      </CardBody>
    </Card>
  );
}
