import type { AuctionResult } from "@dhanvi/types";
import { Callout, Card, CardBody, CardHeader, KeyValueRows, Icons } from "@dhanvi/ui";
import { formatDateTime, formatMoney, formatSignedMoney, humanize } from "@dhanvi/utils";

export function AuctionResultCard({ result, timeZone }: { result: AuctionResult; timeZone: string }) {
  return (
    <Card>
      <CardHeader title="Auction completed" subtitle={`Finalized ${formatDateTime(result.finalizedAt, timeZone)} · ${result.calculationVersion}`} />
      <CardBody className="stack stack--lg">
        <div className="result-hero">
          <span className="check-anim"><Icons.Check size={28} /></span>
          <span className="result-hero__label">Winning member</span>
          <span className="result-hero__name">Member #{result.winner.slotNumber} — {result.winner.displayName}</span>
          <span className="result-hero__slot">Payout right of <strong className="amount">{formatMoney(result.winnerPayout)}</strong></span>
        </div>
        <div className="grid-2">
          <div>
            <h4 className="h-card" style={{ marginBottom: 8 }}>Winner calculation</h4>
            <KeyValueRows items={[
              { key: "Group value", value: <span className="amount">{formatMoney(result.groupValue)}</span> },
              { key: "Winning discount", value: <span className="amount">{formatSignedMoney(result.winningDiscount, "-")}</span> },
            ]} total={{ key: "Winner payout right", value: <span className="amount">{formatMoney(result.winnerPayout)}</span> }} />
          </div>
          <div>
            <h4 className="h-card" style={{ marginBottom: 8 }}>Discount allocation</h4>
            <KeyValueRows items={[
              { key: "Member benefit per non-winner", value: <span className="amount">{formatMoney(result.grossMemberShare)}</span> },
              { key: "Members receiving benefit", value: result.nonWinnerCount },
              { key: "Total member benefit", value: <span className="amount">{formatMoney(result.memberBenefitPool)}</span> },
              { key: "Proposed platform fee", value: <span className="amount">{formatMoney(result.platformFee)}</span> },
              ...(result.myBenefitAllocation !== null ? [{ key: "Your calculated benefit", value: <span className="amount text-success">{formatMoney(result.myBenefitAllocation)}</span> }] : []),
            ]} />
          </div>
        </div>
        <Callout variant="info" title="Finalized allocations">These allocations use the group&apos;s fee policy ({humanize(result.feePolicy)}). See payout settlement for the winner transfer, member benefits and internal fee status.</Callout>
      </CardBody>
    </Card>
  );
}
