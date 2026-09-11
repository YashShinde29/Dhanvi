import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Fact } from "@/components/ui/description";
import { formatDate, formatMoney } from "@/lib/format";
import type { Contribution } from "@/types/contribution";

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
      </CardBody>
    </Card>
  );
}
