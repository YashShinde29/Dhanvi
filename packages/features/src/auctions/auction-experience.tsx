"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Auction, Group, MonthlyCycle } from "@dhanvi/types";
import { Breadcrumbs, Card, CardBody, CardHeader, ErrorState, Icons, LinkButton, SkeletonText } from "@dhanvi/ui";
import { formatDate, formatDateTime, formatMoney, formatSignedMoney, formatTime, humanize } from "@dhanvi/utils";
import { BidPanel } from "./bid-panel";
import { countdown, latestOwnBid, screenPhase, type ScreenPhase } from "./auction-model";
import { useLiveAuction, useTicker } from "./use-live-auction";

/** Which route hosts this experience; members and organizers (participating) both use the member app's group route. */
export interface AuctionExperienceProps { group: Group; cycle: MonthlyCycle; groupHref: string; payoutsHref: string; /** Organizer participating in their own auction. */ participant?: boolean }

/**
 * The flagship monthly auction screen. One page evolves through SCHEDULED → LIVE → CLOSING → COMPLETED.
 * Hierarchy: status + timer → current highest discount → projected winner payout → your status → bid action.
 */
export function AuctionExperience({ group, cycle, groupHref, payoutsHref }: AuctionExperienceProps) {
  const { auction, error, refresh, serverNow } = useLiveAuction(group.id, cycle.id);
  const phase = auction ? screenPhase(auction) : undefined;
  useTicker(phase === "LIVE" || phase === "SCHEDULED");
  const [changed, setChanged] = useState<"up" | null>(null);
  const previous = useRef<number | null>(null);
  // Highlight a movement of the highest discount briefly (no flashing): colour shift + "New highest bid" tag.
  useEffect(() => {
    if (!auction) return;
    if (previous.current !== null && auction.currentHighestDiscount > previous.current) { setChanged("up"); const t = window.setTimeout(() => setChanged(null), 2500); previous.current = auction.currentHighestDiscount; return () => window.clearTimeout(t); }
    previous.current = auction.currentHighestDiscount;
  }, [auction]);

  const crumbs = [{ label: "My groups", href: "/my-groups" }, { label: group.name, href: groupHref }, { label: `Cycle ${cycle.cycleNumber} auction` }];
  if (error && !auction) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={refresh} /></div>;
  if (!auction) return <div className="stack"><Breadcrumbs items={crumbs} /><Card><CardBody><SkeletonText lines={5} /></CardBody></Card></div>;
  const a = auction; const now = serverNow();
  const startsIn = countdown(new Date(a.startsAt).getTime() - now), endsIn = countdown(new Date(a.endsAt).getTime() - now);
  const zone = group.groupTimeZone;

  return (
    <div className={`auc${phase === "LIVE" ? " auc--sticky-space" : ""}`}>
      <Breadcrumbs items={crumbs} />
      <header className="auc__head">
        <div>
          <div className="auc__eyebrow">{a.groupName} · Cycle {a.cycleNumber} of {a.durationMonths}</div>
          <h1 className="auc__title">Cycle {a.cycleNumber} Auction</h1>
          <div className="text-sm text-secondary" style={{ marginTop: 4 }}>{phase === "SCHEDULED" ? `Starts ${formatDateTime(a.startsAt, zone)}` : phase === "LIVE" ? `Closes ${formatDateTime(a.endsAt, zone)}` : `Closed ${formatDateTime(a.closedAt ?? a.endsAt, zone)}`}</div>
        </div>
        <div className="auc__state">
          <StatePill phase={phase!} />
          {phase === "SCHEDULED" && <div className="auc__timer"><span className="auc__timer-label">Starts in</span><span className="auc__timer-value">{startsIn ?? "Opening"}</span></div>}
          {phase === "LIVE" && <div className="auc__timer" aria-live="off"><span className="auc__timer-label">Time left</span><span className={`auc__timer-value${endsIn && new Date(a.endsAt).getTime() - now < 5 * 60000 ? " auc__timer-value--urgent" : ""}`}>{endsIn ?? "Closing"}</span></div>}
        </div>
      </header>

      {phase === "NO_BIDS" && <Card><CardBody className="stack"><div className="text-strong">Auction closed without bids</div><p className="text-sm text-secondary" style={{ margin: 0 }}>No winner or payout right was assigned this cycle. {group.creatorType === "PLATFORM" ? "Dhanvi" : "Your organizer"} will review what happens next.</p></CardBody></Card>}

      <div className="auc__layout">
        <div className="auc__hero-slot">
          {phase === "COMPLETED" && a.result ? <Result auction={a} zone={zone} /> : (
          <section className="auc__hero" aria-label="Auction state">
            {phase === "SCHEDULED" ? (
              <>
                <div><div className="auc__label">Group value</div><div className="auc__big amount">{formatMoney(a.groupValue)}</div></div>
                <dl className="auc__facts"><Fact label="Minimum discount" value={formatMoney(a.minimumDiscount)} /><Fact label="Bid increment" value={formatMoney(a.bidIncrement)} /><Fact label="Maximum discount" value={formatMoney(a.maximumDiscount)} /></dl>
                <div className="auc__formula"><div className="text-strong" style={{ marginBottom: 4 }}>What happens when the auction opens?</div><p className="text-sm text-secondary" style={{ margin: 0 }}>Eligible members submit a discount. The highest valid discount wins. Winner payout = group value − winning discount.</p></div>
                <p className="text-sm text-secondary" style={{ margin: 0 }}><Icons.Clock size={14} style={{ display: "inline", verticalAlign: "-2px" }} /> No action required yet. Return when the auction opens.</p>
              </>
            ) : (
              <>
                <div className="auc__hero-grid">
                  <div>
                    <div className="auc__label">{phase === "COMPLETED" ? "Winning discount" : "Current highest discount"}</div>
                    <div className={`auc__big amount${changed ? " auc__big--changed" : ""}`} aria-live="polite" aria-atomic="true">{a.bidCount ? formatMoney(a.currentHighestDiscount) : "—"}</div>
                    {changed && <span className="auc__delta" role="status"><Icons.Trending size={14} /> New highest bid</span>}
                    {!a.bidCount && phase === "LIVE" && <span className="text-sm text-secondary">No bids yet · first valid bid {formatMoney(a.minimumNextBid)}</span>}
                  </div>
                  <div>
                    <div className="auc__label">{phase === "COMPLETED" ? "Winner payout" : "Projected winner payout"}</div>
                    <div className="auc__mid amount">{formatMoney(a.bidCount ? a.potentialWinnerPayout : a.groupValue)}</div>
                    <div className="text-sm text-muted">Group value <span className="amount">{formatMoney(a.groupValue)}</span></div>
                  </div>
                </div>
                <div className="auc__formula" aria-label="How the payout is calculated">
                  <div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>What does this mean?</div>
                  <div className="auc__formula-row"><span>Group value</span><strong className="amount">{formatMoney(a.groupValue)}</strong></div>
                  <div className="auc__formula-row"><span>{phase === "COMPLETED" ? "Winning discount" : "Current discount"}</span><strong className="amount">{formatSignedMoney(a.currentHighestDiscount, "-")}</strong></div>
                  <div className="auc__formula-row auc__formula-row--total"><span>Winner receives</span><strong className="amount">{formatMoney(a.groupValue - a.currentHighestDiscount)}</strong></div>
                </div>
              </>
            )}
          </section>
          )}
        </div>

        <aside className="auc__side" aria-label="Your bid">
          {phase === "LIVE" && <BidPanel groupId={group.id} cycleId={cycle.id} auction={a} onPlaced={refresh} onStale={refresh} />}
          {phase === "CLOSING" && <div className="auc__panel"><div className="auc__status auc__status--closed"><span className="auc__status-tag">Auction closed</span><span className="auc__status-title">Finalizing result…</span><p className="text-sm text-secondary" style={{ margin: 0 }}>Bids are no longer accepted. The result appears here as soon as it is recorded.</p></div></div>}
          {phase === "SCHEDULED" && <div className="auc__panel"><div className="auc__status auc__status--closed"><span className="auc__status-tag">Your status</span><span className="auc__status-title">{a.canBid || a.bidUnavailableReason === "Auction is not open." ? "Waiting for the auction to open" : "Not eligible this cycle"}</span><p className="text-sm text-secondary" style={{ margin: 0 }}>{a.bidUnavailableReason && a.bidUnavailableReason !== "Auction is not open." ? a.bidUnavailableReason : "No action required yet."}</p></div></div>}
          {phase === "COMPLETED" && a.result && <PersonalResult auction={a} payoutsHref={payoutsHref} />}
          {phase === "NO_BIDS" && <div className="auc__panel"><div className="auc__status auc__status--closed"><span className="auc__status-tag">Your status</span><span className="auc__status-title">No bids were placed</span></div></div>}
        </aside>

        <div className="auc__extras">
          {phase !== "SCHEDULED" && (
            <Card>
              <CardHeader title="Recent bid activity" subtitle={a.bidCount ? `${a.bidCount} bid${a.bidCount === 1 ? "" : "s"} · ${a.eligibleBidderCount} eligible members` : "No bids yet"} />
              <CardBody>
                {a.recentBids.length === 0 ? <p className="text-sm text-muted" style={{ margin: 0 }}>Bids appear here as members place them.</p> : (
                  <ol className="auc__activity" aria-label="Recent bids">
                    {a.recentBids.map((b, i) => <li key={`${b.submittedAt}-${i}`} data-new={i === 0 && !!changed}><span className="auc__activity-amount amount">{formatMoney(b.discountAmount)}</span><span className="auc__activity-time">{formatTime(b.submittedAt, zone)}</span><span className="auc__activity-meta">Member {b.memberSlot}{b.isMine ? " · you" : ""}{b.isCurrentHighest && phase === "LIVE" ? " · leading" : ""}</span></li>)}
                  </ol>
                )}
              </CardBody>
            </Card>
          )}

          {a.myBids.length > 0 && (
            <Card>
              <CardHeader title="Your bids" />
              <CardBody>
                <ol className="auc__activity" aria-label="Your bids">
                  {[...a.myBids].sort((x, y) => y.sequenceNumber - x.sequenceNumber).map((b) => <li key={b.bidId}><span className="auc__activity-amount amount">{formatMoney(b.discountAmount)}</span><span className="auc__activity-time">{formatTime(b.submittedAt, zone)}</span><span className="auc__activity-meta">{b.isCurrentWinningBid ? (phase === "COMPLETED" ? "Winning bid" : "Leading") : "Outbid"}</span></li>)}
                </ol>
              </CardBody>
            </Card>
          )}

          <dl className="auc__facts" aria-label="Auction details">
            <Fact label="Group value" value={formatMoney(a.groupValue)} /><Fact label="Cycle" value={`${a.cycleNumber} of ${a.durationMonths}`} /><Fact label="Eligible bidders" value={String(a.eligibleBidderCount)} />
            <Fact label="Total bids" value={String(a.bidCount)} /><Fact label="Bid increment" value={formatMoney(a.bidIncrement)} /><Fact label="Maximum discount" value={formatMoney(a.maximumDiscount)} />
          </dl>

          <details className="disclosure"><summary>How this auction works</summary><div className="disclosure__body"><ol className="text-sm text-secondary" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}><li>Eligible members submit a discount.</li><li>A higher valid discount becomes the leading bid (ties go to the earlier bid).</li><li>When the auction closes, the highest valid discount wins.</li><li>Winner payout = group value − winning discount.</li></ol></div></details>
          <details className="disclosure"><summary>What happens to the winning discount?</summary><div className="disclosure__body"><p className="text-sm text-secondary" style={{ margin: 0 }}>Under this group&apos;s fee policy (winner member share), the winning discount is shared as an auction benefit among the other {Math.max(0, group.memberLimit - 1)} members after the platform fee, and the winner receives the group value minus their discount. Benefits are calculated when the auction closes and settled with the cycle&apos;s payouts.</p></div></details>

          <p className="text-sm text-secondary" style={{ margin: 0 }}>
            {phase === "COMPLETED" ? <>Next: cycle {a.cycleNumber < a.durationMonths ? `${a.cycleNumber + 1} contribution collection begins after this cycle's settlement completes.` : "— this was the final cycle."}</> : phase === "SCHEDULED" ? `The auction runs on ${formatDate(cycle.selectionDate)} once all contributions are settled.` : "The backend enforces the window and validates every bid; this countdown is informational."}
            {" "}<Link className="link" href={groupHref}>Back to group</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function StatePill({ phase }: { phase: ScreenPhase }) {
  const map: Record<ScreenPhase, [string, string]> = { SCHEDULED: ["", "Scheduled"], LIVE: ["auc__pill--live", "Live"], CLOSING: ["auc__pill--closing", "Closing"], COMPLETED: ["auc__pill--done", "Completed"], NO_BIDS: ["auc__pill--closing", "Closed · no bids"] };
  return <span className={`auc__pill ${map[phase][0]}`}>{map[phase][1]}</span>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="auc__fact"><dt>{label}</dt><dd className="amount">{value}</dd></div>; }

function Result({ auction: a, zone }: { auction: Auction; zone: string }) {
  const r = a.result!;
  const won = a.myBids.some((b) => b.bidId === r.winningBidId);
  return (
    <section className={`auc__result${won ? " auc__result--won" : ""}`} aria-label="Auction result">
      <div className="auc__result-head"><span className="check-anim" style={{ width: 36, height: 36, flex: "none" }}><Icons.Check size={20} /></span><div><div className="auc__label">Auction completed</div><div className="auc__status-title">{won ? "You won this cycle ✓" : `Member ${r.winner.slotNumber} won this cycle`}</div></div></div>
      <div><div className="auc__label">Winning discount</div><div className="auc__big amount">{formatMoney(r.winningDiscount)}</div></div>
      <div className="auc__result-grid">
        <div><div className="text-xs text-muted">{won ? "Your payout" : "Winner payout"}</div><div className="auc__mid amount">{formatMoney(r.winnerPayout)}</div></div>
        {!won && r.myBenefitAllocation !== null && <div><div className="text-xs text-muted">Your auction benefit</div><div className="auc__mid amount text-success">{formatMoney(r.myBenefitAllocation)}</div></div>}
        <div><div className="text-xs text-muted">Group value</div><div className="auc__mid amount">{formatMoney(r.groupValue)}</div></div>
      </div>
      <div className="auc__formula" aria-label="How the payout was calculated">
        <div className="auc__formula-row"><span>Group value</span><strong className="amount">{formatMoney(r.groupValue)}</strong></div>
        <div className="auc__formula-row"><span>Winning discount</span><strong className="amount">{formatSignedMoney(r.winningDiscount, "-")}</strong></div>
        <div className="auc__formula-row auc__formula-row--total"><span>Winner receives</span><strong className="amount">{formatMoney(r.winnerPayout)}</strong></div>
      </div>
      <div className="text-xs text-muted">Finalized {formatDateTime(r.finalizedAt, zone)} · {r.calculationVersion}</div>
    </section>
  );
}
function PersonalResult({ auction: a, payoutsHref }: { auction: Auction; payoutsHref: string }) {
  const r = a.result!; const won = a.myBids.some((b) => b.bidId === r.winningBidId); const own = latestOwnBid(a);
  return (
    <div className="auc__panel">
      <div className={`auc__status ${won ? "auc__status--leading" : "auc__status--closed"}`}>
        <span className="auc__status-tag">Your result</span>
        <span className="auc__status-title">{won ? "You won this cycle ✓" : own ? "Not this cycle" : "You did not bid"}</span>
        <dl className="auc__status-grid">
          {won ? <><div><dt>Your payout</dt><dd>{formatMoney(r.winnerPayout)}</dd></div><div><dt>Payout status</dt><dd style={{ fontSize: "var(--text-base)" }}>{humanize(r.allocationStatus)}</dd></div></>
            : <><div><dt>Your auction benefit</dt><dd>{r.myBenefitAllocation !== null ? formatMoney(r.myBenefitAllocation) : "—"}</dd></div><div><dt>Benefit status</dt><dd style={{ fontSize: "var(--text-base)" }}>{humanize(r.allocationStatus)}</dd></div></>}
        </dl>
      </div>
      <div className="auc__bid"><LinkButton href={payoutsHref} variant="secondary" block>View payout status</LinkButton></div>
    </div>
  );
}
