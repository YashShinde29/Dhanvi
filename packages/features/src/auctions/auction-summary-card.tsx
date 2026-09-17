"use client";
import type { Group, MonthlyCycle } from "@dhanvi/types";
import { Card, CardBody, LinkButton } from "@dhanvi/ui";
import { formatDate, formatDateTime, formatMoney } from "@dhanvi/utils";
import { countdown, latestOwnBid, personalState, screenPhase } from "./auction-model";
import { useLiveAuction, useTicker } from "./use-live-auction";

/**
 * Compact monthly cycle card for group pages and dashboards: live state, current highest discount, time left and
 * exactly one link into the dedicated auction screen. No bidding controls live here.
 */
export function AuctionSummaryCard({ group, cycle, href, viewer }: { group: Group; cycle: MonthlyCycle; href: string; viewer: "member" | "organizer" | "admin" }) {
  const { auction, serverNow } = useLiveAuction(group.id, cycle.id);
  const phase = auction ? screenPhase(auction) : undefined;
  useTicker(phase === "LIVE");
  const a = auction;
  const personal = a ? personalState(a) : undefined; const own = a ? latestOwnBid(a) : undefined;
  const left = a && phase === "LIVE" ? countdown(new Date(a.endsAt).getTime() - serverNow()) : null;
  const label = viewer === "member" ? (phase === "LIVE" ? "Enter auction" : phase === "COMPLETED" || phase === "NO_BIDS" ? "View result" : "View auction") : "Auction operations";
  return (
    <Card>
      <CardBody className="stack">
        <div className="row row--between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="auc__eyebrow">Cycle {cycle.cycleNumber} · Auction</div>
            <div className="text-strong" style={{ fontSize: "var(--text-lg)" }}>{!a ? "Loading auction…" : phase === "LIVE" ? "Auction live" : phase === "SCHEDULED" ? (cycle.status === "READY_FOR_SELECTION" ? `Scheduled · opens ${formatDateTime(a.startsAt, group.groupTimeZone)}` : "Scheduled after contributions are complete") : phase === "CLOSING" ? "Closed · finalizing" : phase === "NO_BIDS" ? "Closed without bids" : "Auction completed ✓"}</div>
          </div>
          {a && <span className={`auc__pill ${phase === "LIVE" ? "auc__pill--live" : phase === "COMPLETED" ? "auc__pill--done" : ""}`}>{phase === "LIVE" ? "Live" : phase === "COMPLETED" ? "Completed" : phase === "SCHEDULED" ? "Scheduled" : "Closed"}</span>}
        </div>
        {a && (phase === "LIVE" || phase === "COMPLETED") && (
          <div className="grid-3" style={{ gap: 12 }}>
            <div className="fact"><span className="fact__label">{phase === "COMPLETED" ? "Winning discount" : "Current highest discount"}</span><span className="fact__value fact__value--lg amount">{a.bidCount ? formatMoney(a.currentHighestDiscount) : "—"}</span></div>
            <div className="fact"><span className="fact__label">{phase === "COMPLETED" ? "Winner payout" : "Projected winner payout"}</span><span className="fact__value amount">{formatMoney(a.bidCount ? a.potentialWinnerPayout : a.groupValue)}</span></div>
            {phase === "LIVE" ? <div className="fact"><span className="fact__label">Ends in</span><span className="fact__value">{left ?? "Closing"}</span></div> : <div className="fact"><span className="fact__label">Winner</span><span className="fact__value">Member {a.result?.winner.slotNumber ?? a.currentLeaderSlot ?? "—"}</span></div>}
          </div>
        )}
        {a && viewer === "member" && phase === "LIVE" && <p className="text-sm text-secondary" style={{ margin: 0 }}>{personal === "LEADING" ? `You're leading with ${formatMoney(own!.discountAmount)}.` : personal === "OUTBID" ? `You've been outbid · minimum next bid ${formatMoney(a.minimumNextBid)}.` : personal === "NOT_BID" ? `You haven't bid yet · minimum ${formatMoney(a.minimumNextBid)}.` : "You cannot bid in this cycle."}</p>}
        {a && phase === "SCHEDULED" && <p className="text-sm text-secondary" style={{ margin: 0 }}>Auction date {formatDate(cycle.selectionDate)} · minimum discount {formatMoney(a.minimumDiscount)} · increment {formatMoney(a.bidIncrement)}.</p>}
        <div><LinkButton href={href} variant={viewer === "member" && phase === "LIVE" ? "primary" : "secondary"}>{label}</LinkButton></div>
      </CardBody>
    </Card>
  );
}
