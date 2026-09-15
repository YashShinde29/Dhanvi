import { StatusBadge, Card, CardBody, Fact } from "@dhanvi/ui";
import { formatDate, formatMoney } from "@dhanvi/utils";
import type { Contribution } from "@dhanvi/types";
import { PaymentCheckout } from "../payments/payment-checkout";

/** Member-facing contribution summary for one cycle. */
export function ContributionSummaryCard({ contribution, compact, showGroup }: { contribution: Contribution; compact?: boolean; showGroup?: boolean }) {
  return (
    <Card muted={compact}>
      <CardBody className="stack" style={compact ? { padding: 16 } : undefined}>
        <div className="row row--between">
          <div>
            <div className="text-strong">{showGroup ? contribution.groupName : "Your contribution"} · Cycle {contribution.cycleNumber}</div>
            <div className="text-sm text-muted">Due {formatDate(contribution.dueDate)}</div>
          </div>
          <StatusBadge kind="contribution" value={contribution.status} />
        </div>
        <div className="grid-3" style={{ gap: 12 }}>
          <Fact label="Expected" value={formatMoney(contribution.expectedAmount)} />
          <Fact label="Recorded" value={formatMoney(contribution.recordedAmount)} />
          <Fact label="Recorded on" value={contribution.recordedAt ? formatDate(contribution.recordedAt, contribution.groupTimeZone) : "—"} />
        </div>
        {contribution.collectionMode === "RAZORPAY" ? <PaymentCheckout contributionId={contribution.id} groupName={contribution.groupName} cycleNumber={contribution.cycleNumber} dueDate={contribution.dueDate} />
          : contribution.status === "RECORDED" ? <p className="text-sm text-secondary"><strong>Recorded ✓</strong> · Your contribution for cycle {contribution.cycleNumber} is complete. Next: waiting for other group members.</p>
          : <p className="text-sm text-secondary"><strong>Next action:</strong> pay {formatMoney(contribution.expectedAmount - contribution.recordedAmount)} to your organizer by {formatDate(contribution.dueDate)}; they record it here. {contribution.status === "OVERDUE" && <span className="text-danger">This contribution is overdue.</span>}</p>}
      </CardBody>
    </Card>
  );
}
