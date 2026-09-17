"use client";
import Link from "next/link";
import { useAsyncData, humanize, formatMoney, statusGuidance } from "@dhanvi/utils";
import { payoutService, type GroupScope } from "@dhanvi/api-client";
import { Badge, Card, CardBody, CardHeader, ErrorState, SkeletonText } from "@dhanvi/ui";

/**
 * Payout status for one selected cycle, in the viewer's own words. Members see only their payouts; organizers see the
 * group's. No command here — approval and execution belong to Dhanvi admin's payout screens.
 */
export function CyclePayoutStatus({ cycleId, groupId, scope }: { cycleId: string; groupId: string; scope: GroupScope }) {
  const organizer = scope === "organizer";
  const data = useAsyncData(() => organizer ? payoutService.group(groupId, 1) : payoutService.list(false, "page=1"), [groupId, organizer]);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  const rows = (data.data?.items ?? []).filter((p) => p.cycleId === cycleId);
  return (
    <Card>
      <CardHeader title="Payout" subtitle={organizer ? "Dhanvi processes payouts; you can follow their status here." : "Where this cycle's payout stands for you."} />
      <CardBody className="stack">
        {!data.data ? <SkeletonText lines={2} /> : rows.length === 0 ? (
          <p className="text-sm text-secondary">{organizer ? "Dhanvi is preparing this cycle's payout. No action is required from you." : "No payout is due to you for this cycle."}</p>
        ) : rows.map((p) => {
          const g = statusGuidance("payout", p.status);
          const delayed = p.status === "FAILED" || p.status === "RECONCILIATION_REQUIRED";
          return (
            <div key={p.id} className="row row--between" style={{ alignItems: "flex-start" }}>
              <div><div className="text-strong">{humanize(p.payoutType)} · <span className="amount">{formatMoney(p.amount)}</span></div>
                <div className="text-sm text-secondary">{delayed ? "Your payout is delayed. Dhanvi is reviewing the transfer. No action is required from you." : g.description}</div></div>
              <span className="row" style={{ gap: 8 }}><Badge tone={p.status === "SUCCEEDED" ? "success" : delayed ? "warning" : "neutral"}>{delayed ? "Under review" : g.stage}</Badge>{!organizer && <Link className="link text-sm" href={`/payouts/${p.id}`}>Details</Link>}</span>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
