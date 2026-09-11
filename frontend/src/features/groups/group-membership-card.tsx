"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { groupService } from "@/services/group.service";
import type { Group } from "@/types/group";
import { StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/form";
import { Icons } from "@/components/ui/icons";
import { Timeline, type TimelineStep } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney, formatMonthlyDay } from "@/lib/format";
import { RuleList } from "@/components/ui/description";

function journey(group: Group): TimelineStep[] {
  const own = group.myMembership;
  const termsDone = !!own?.termsAcceptedAt && own.termsVersionId === group.currentRules?.id;
  const stage = !own ? 0 : own.status === "APPLIED" ? 1 : own.status === "APPROVED" && !termsDone ? 2 : own.status === "APPROVED" ? 3 : own.status === "ACTIVE" || own.status === "COMPLETED" ? 4 : -1;
  const steps: [string, string][] = [
    ["Apply to join", "Submit your application to the group organizer."],
    ["Application submitted", "Waiting for review. No payment is needed."],
    ["Approved · accept the rules", "Review and accept the published group rules."],
    ["Ready", "You're in. The group starts once all positions are filled."],
    ["Active member", "Contribute each cycle and await your payout turn."],
  ];
  return steps.map(([title, description], index) => ({ id: String(index), title, description, state: stage === -1 ? "upcoming" : index < stage ? "done" : index === stage ? "current" : "upcoming" }));
}

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
    try { await groupService.action(`groups/${group.id}/applications`); toast.success("Application submitted", `${organizerName} will review your application.`); await onChanged(); }
    catch (failure) { toast.error("Application not submitted", friendlyError(failure)); }
    finally { setBusy(false); }
  }

  async function acceptRules() {
    if (!group.currentRules || !accepted) return;
    setBusy(true);
    try {
      await groupService.action(`groups/${group.id}/accept-terms`, { groupRuleVersionId: group.currentRules.id, rulesHash: group.currentRules.rulesHash });
      toast.success("Rules accepted", `You accepted group rules version ${group.rulesVersion}.`);
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

  return (
    <Card>
      <CardHeader title="Your membership" actions={own && <StatusBadge kind="membership" value={own.status} />} />
      <CardBody className="stack stack--lg">
        {!own && group.status === "RECRUITING" && (
          <div className="stack">
            <p className="text-secondary">{group.availableSlots} of {group.memberLimit} positions are still open. Applying is free and reversible until approval.</p>
            <Button block loading={busy} onClick={apply} icon={<Icons.Send size={16} />}>Apply to join</Button>
          </div>
        )}
        {!own && group.status !== "RECRUITING" && <Callout variant="neutral">This group is not accepting new applications.</Callout>}
        {own?.status === "APPLIED" && <Callout variant="info" title="Application pending">Your application has been submitted to {organizerName}. You&apos;ll see the decision here.</Callout>}
        {own?.status === "REJECTED" && <Callout variant="danger" title="Application not approved">{own.rejectedReason || "The organizer did not approve this application."}</Callout>}
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
        {own?.status === "APPROVED" && termsCurrent && <Callout variant="success" title="You're ready">Rules accepted on {formatDateTime(own.termsAcceptedAt)}. The group will start once every position is filled and confirmed.</Callout>}
        {own?.status === "ACTIVE" && <p className="text-sm text-secondary">You are an active member{own.slotNumber ? ` in position #${own.slotNumber}` : ""}. Track your contributions under the Cycles tab.</p>}
        <Timeline steps={journey(group)} />
      </CardBody>
    </Card>
  );
}
