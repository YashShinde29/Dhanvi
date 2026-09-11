import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RuleList } from "@/components/ui/description";
import { Callout } from "@/components/ui/callout";
import { Icons } from "@/components/ui/icons";
import { formatClockTime, formatDate, formatMoney, formatMonthlyDay } from "@/lib/format";
import type { Group } from "@/types/group";

/** The rules every member must understand, shown prominently — never buried in small text. */
export function ImportantRulesCard({ group }: { group: Group }) {
  const auction = group.groupType === "AUCTION";
  const items = [
    { key: "Group type", value: auction ? "Auction" : "Random draw" },
    { key: "Group value", value: formatMoney(group.groupValue) },
    { key: "Monthly contribution", value: formatMoney(group.monthlyContribution) },
    { key: "Duration", value: `${group.durationMonths} months` },
    { key: "Members", value: `${group.memberLimit}` },
    ...(group.creatorType === "ORGANIZER" ? [{ key: "Organizer participating", value: group.organizerParticipates ? "Yes" : "No" }] : []),
    { key: "First payout", value: group.organizerFirstPayout ? "Organizer reserved (cycle 1)" : auction ? "Auction from cycle 1" : "Random draw from cycle 1" },
    ...(group.organizerFirstPayout ? [{ key: auction ? "Auctions start" : "Random draws start", value: "Cycle 2" }] : []),
    { key: "Start date", value: formatDate(group.startDate) },
    { key: "Contribution date", value: formatMonthlyDay(group.contributionDueDay) },
    { key: auction ? "Auction date" : "Selection date", value: formatMonthlyDay(group.selectionDay) },
    { key: "Payout date", value: formatMonthlyDay(group.payoutDay) },
    ...(group.auctionRules ? [
      { key: "Discount range", value: `${formatMoney(group.auctionRules.minimumDiscount)} – ${formatMoney(group.auctionRules.maximumDiscount)}` },
      { key: "Bid increment", value: formatMoney(group.auctionRules.bidIncrement) },
      { key: "Auction window", value: `${formatClockTime(group.auctionRules.auctionStartTime)} – ${formatClockTime(group.auctionRules.auctionEndTime)}` },
    ] : []),
  ];
  return (
    <Card>
      <CardHeader title={<span className="row" style={{ gap: 8 }}><Icons.FileText size={18} style={{ color: "var(--color-primary-700)" }} /> Important group rules</span>} subtitle={group.rulesVersion ? `Rules version ${group.rulesVersion}${group.rulesLocked ? " · locked" : ""}` : "Draft — not yet published"} />
      <CardBody className="stack">
        <RuleList items={items} />
        {group.organizerFirstPayout && (
          <Callout variant="warning" title="Organizer receives the first payout">
            The organizer is reserved to receive the cycle 1 payout right — the full group value with no discount. {auction ? "Auctions" : "Random draws"} begin from cycle 2. The organizer keeps contributing for every remaining cycle.
          </Callout>
        )}
        <Callout variant="neutral">
          Each member receives the main payout once and continues contributing for all remaining cycles. {auction ? "The auction payout equals the group value minus the winning discount." : "The selected member receives the full group value."} Dhanvi does not process payments at this stage.
        </Callout>
      </CardBody>
    </Card>
  );
}

export function RulesSnapshot({ group }: { group: Group }) {
  if (!group.currentRules) return null;
  return (
    <details className="disclosure">
      <summary>Published rules snapshot &amp; hash (version {group.currentRules.versionNumber})</summary>
      <div className="disclosure__body">
        <p className="text-sm text-muted">This is the exact snapshot members accept. The hash lets anyone confirm the rules haven&apos;t changed.</p>
        <pre className="pre">{group.currentRules.rulesSnapshot}</pre>
        <div><div className="text-xs text-muted">Rules hash</div><code className="mono">{group.currentRules.rulesHash}</code></div>
      </div>
    </details>
  );
}
