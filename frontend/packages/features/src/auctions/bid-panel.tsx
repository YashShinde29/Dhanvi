"use client";
import { useRef, useState } from "react";
import type { Auction } from "@dhanvi/types";
import { ApiError, auctionService } from "@dhanvi/api-client";
import { Button, Callout, Dialog, FormField, KeyValueRows, MoneyInput, useToast } from "@dhanvi/ui";
import { formatMoney, formatSignedMoney, friendlyError } from "@dhanvi/utils";
import { ineligibilityText, latestOwnBid, maximumReached, money, personalState, projectedPayout, quickBids, validateBid } from "./auction-model";

export interface BidPanelProps { groupId: string; cycleId: string; auction: Auction; onPlaced: () => Promise<void>; onStale: () => Promise<void> }

/**
 * Member action side of the live auction: personal status, valid next options, custom discount bid with live payout
 * preview, then Review bid → Confirm & Place Bid. This is the ONLY place that calls the bid API, and only from the
 * confirmation button: chips and typing just update the local preview; Enter opens the review, never submits.
 * Before submitting, the latest auction state is re-read and the amount revalidated; if the auction moved, nothing is
 * sent and the member must choose a new amount explicitly.
 */
export function BidPanel({ groupId, cycleId, auction: a, onPlaced, onStale }: BidPanelProps) {
  const toast = useToast();
  const [custom, setCustom] = useState("");
  const [chosen, setChip] = useState<number | null>(null);
  // A quick option that is no longer valid (the auction moved) drops out; options re-render from live data.
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<{ highest: number; next: number } | null>(null);
  const key = useRef<{ amount: string; value: string } | null>(null);
  const state = personalState(a);
  const own = latestOwnBid(a);
  const options = quickBids(a);
  const chip = chosen !== null && options.includes(chosen) ? chosen : null;
  const selected = chip !== null ? String(chip) : custom;
  const error = validateBid(a, selected);
  const amount = selected && !error ? Number(selected) : null;
  const maxed = maximumReached(a);

  function moved(latest: Auction) { setReviewing(false); setStale({ highest: latest.currentHighestDiscount, next: latest.minimumNextBid }); }

  async function place() {
    if (amount === null || busy) return; // busy guard: no double-click or duplicate request
    const text = String(amount);
    setBusy(true);
    try {
      // Revalidate against the latest authoritative state: another member may have bid while the dialog was open.
      const latest = await auctionService.get(groupId, cycleId);
      if (latest.status !== "OPEN") { setReviewing(false); await onStale(); toast.error("This auction has already closed", "No further bids are accepted."); return; }
      if (amount < latest.minimumNextBid || amount > latest.maximumDiscount) { moved(latest); await onStale(); return; }
      if (key.current?.amount !== text) key.current = { amount: text, value: crypto.randomUUID() };
      const accepted = await auctionService.bid(groupId, cycleId, text, key.current.value);
      key.current = null; setReviewing(false); setCustom(""); setChip(null); setStale(null);
      await onPlaced();
      const after = await auctionService.get(groupId, cycleId).catch(() => null);
      const mine = after ? [...after.myBids].sort((x, y) => y.sequenceNumber - x.sequenceNumber)[0] : undefined;
      toast.success("Bid placed successfully ✓", `Your bid ${formatMoney(accepted.discountAmount)} · ${mine?.isCurrentWinningBid ? "You are leading." : after ? `Current highest is now ${formatMoney(after.currentHighestDiscount)}.` : "Accepted."}`);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : null;
      if (code === "BID_INCREMENT_NOT_MET" || code === "DISCOUNT_ABOVE_MAXIMUM") { await onStale(); const latest = await auctionService.get(groupId, cycleId).catch(() => a); moved(latest); }
      else if (code === "AUCTION_CLOSED" || code === "AUCTION_NOT_OPEN" || code === "AUCTION_OUTSIDE_WINDOW") { setReviewing(false); await onStale(); toast.error("This auction has already closed", "No further bids are accepted."); }
      else toast.error("Bid not placed", friendlyError(failure));
    } finally { setBusy(false); }
  }
  // Enter in the custom field opens the review — it never places a bid.
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) { if (e.key === "Enter") { e.preventDefault(); if (amount !== null && !busy) setReviewing(true); } }

  const status = (
    <div className={`auc__status auc__status--${state === "LEADING" ? "leading" : state === "OUTBID" ? "outbid" : state === "NOT_BID" ? "none" : state === "INELIGIBLE" ? "ineligible" : "closed"}`} aria-live="polite">
      <span className="auc__status-tag">Your status</span>
      {state === "LEADING" && <><span className="auc__status-title">You&apos;re currently leading</span><dl className="auc__status-grid"><div><dt>Your bid</dt><dd>{formatMoney(own!.discountAmount)}</dd></div><div><dt>Projected payout</dt><dd>{formatMoney(projectedPayout(a, own!.discountAmount))}</dd></div></dl><p className="text-sm text-secondary" style={{ margin: 0 }}>No action is needed unless another member outbids you.</p></>}
      {state === "OUTBID" && <><span className="auc__status-title">You&apos;ve been outbid</span><dl className="auc__status-grid"><div><dt>Your last bid</dt><dd>{formatMoney(own!.discountAmount)}</dd></div><div><dt>Current highest</dt><dd>{formatMoney(a.currentHighestDiscount)}</dd></div><div><dt>Minimum next bid</dt><dd>{formatMoney(a.minimumNextBid)}</dd></div></dl></>}
      {state === "NOT_BID" && <><span className="auc__status-title">You haven&apos;t placed a bid yet</span><p className="text-sm text-secondary" style={{ margin: 0 }}>If you bid <strong className="amount">{formatMoney(a.minimumNextBid)}</strong> and win, your projected payout is <strong className="amount">{formatMoney(projectedPayout(a, a.minimumNextBid))}</strong>.</p></>}
      {state === "INELIGIBLE" && <><span className="auc__status-title">You cannot participate in this auction</span><p className="text-sm text-secondary" style={{ margin: 0 }}><strong>Reason:</strong> {ineligibilityText(a.bidUnavailableReason)}</p></>}
      {state === "CLOSED" && <><span className="auc__status-title">Auction closed</span><p className="text-sm text-secondary" style={{ margin: 0 }}>No further bids are accepted.</p></>}
    </div>
  );

  if (state === "INELIGIBLE" || state === "CLOSED" || state === "SCHEDULED") return <div className="auc__panel">{status}</div>;
  if (maxed) return <div className="auc__panel">{status}<div className="auc__bid"><Callout variant="neutral" title="Maximum discount reached">The current highest discount equals the maximum of {formatMoney(a.maximumDiscount)}. No higher bid can be submitted.</Callout></div></div>;

  return (
    <div className="auc__panel">
      {status}
      <div className="auc__bid">
        {stale && (
          <div className="auc__stale" role="alert">
            <strong>The auction has moved. Your bid was not submitted.</strong>
            <dl className="auc__status-grid" style={{ margin: 0 }}><div><dt>Current highest discount</dt><dd>{formatMoney(Math.max(stale.highest, a.currentHighestDiscount))}</dd></div><div><dt>Minimum next bid</dt><dd>{formatMoney(Math.max(stale.next, a.minimumNextBid))}</dd></div></dl>
            <div><Button size="sm" variant="secondary" onClick={() => { setChip(null); setCustom(""); setStale(null); document.getElementById("auction-custom-bid")?.focus(); }}>Update bid</Button></div>
            <span className="text-xs text-muted">Choose a new amount and review it again; nothing is submitted for you.</span>
          </div>
        )}
        <div className="row row--between"><h3 className="auc__bid-title">Place your bid</h3><span className="text-sm text-secondary">Minimum next <strong className="amount">{formatMoney(a.minimumNextBid)}</strong></span></div>
        <div>
          <div className="text-xs text-muted" style={{ marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Quick bid</div>
          <div className="auc__quick" role="group" aria-label="Valid bid options">
            {options.map((v) => <button key={v} type="button" className="auc__chip" aria-pressed={chip === v} onClick={() => { setChip(chip === v ? null : v); setCustom(""); }}>{money(v)}</button>)}
          </div>
        </div>
        <FormField label="Custom discount" htmlFor="auction-custom-bid" error={custom ? error ?? undefined : undefined} help={!custom ? `Between ${formatMoney(a.minimumNextBid)} and ${formatMoney(a.maximumDiscount)}.` : undefined}>
          <MoneyInput id="auction-custom-bid" value={custom} onChange={(v) => { setCustom(v); setChip(null); }} onKeyDown={onKey} invalid={!!custom && !!error} placeholder={String(a.minimumNextBid)} disabled={busy} autoComplete="off" inputMode="numeric" enterKeyHint="done" />
        </FormField>
        <div className="auc__preview" aria-live="polite">
          <span><span className="text-xs text-muted" style={{ display: "block" }}>Your discount bid</span><strong className="amount">{amount !== null ? formatMoney(amount) : "—"}</strong></span>
          <span style={{ textAlign: "right" }}><span className="text-xs text-muted" style={{ display: "block" }}>Projected winner payout</span><strong className="amount">{amount !== null ? formatMoney(projectedPayout(a, amount)) : "—"}</strong></span>
        </div>
        <Button block size="lg" disabled={amount === null || busy} onClick={() => setReviewing(true)}>Review bid</Button>
      </div>
      {!reviewing && <BidSticky amount={amount} onReview={() => setReviewing(true)} />}
      {amount !== null && (
        <Dialog open={reviewing} onClose={() => !busy && setReviewing(false)} title="Confirm your bid" description={`${a.groupName} · Cycle ${a.cycleNumber}`}
          footer={<><Button variant="secondary" onClick={() => setReviewing(false)} disabled={busy}>Cancel</Button><Button onClick={place} loading={busy} disabled={busy}>{busy ? "Placing bid…" : "Confirm & place bid"}</Button></>}>
          <KeyValueRows items={[{ key: "Group value", value: <span className="amount">{formatMoney(a.groupValue)}</span> }, { key: "Current highest discount", value: <span className="amount">{a.bidCount ? formatMoney(a.currentHighestDiscount) : "No bids yet"}</span> }, { key: "Your discount bid", value: <span className="amount">{formatSignedMoney(amount, "-")}</span> }]} total={{ key: "Projected payout if you win", value: <span className="amount">{formatMoney(projectedPayout(a, amount))}</span> }} />
          <p className="text-xs text-muted" style={{ marginTop: 8 }}>Bid increment {formatMoney(a.bidIncrement)} · a discount bid reduces the payout you would receive; it is not an amount you pay.</p>
          <p className="text-sm text-secondary" style={{ marginBottom: 0 }}><strong>Important:</strong> this bid cannot be cancelled after it is accepted. It is checked against the live auction state again when you confirm.</p>
        </Dialog>
      )}
    </div>
  );
}

/** Mobile sticky action shown only while a bid has been chosen. */
export function BidSticky({ amount, onReview }: { amount: number | null; onReview: () => void }) {
  if (amount === null) return null;
  return <div className="auc__sticky" role="region" aria-label="Review your bid"><div className="auc__sticky-text"><span>Selected discount</span><strong>{formatMoney(amount)}</strong></div><Button onClick={onReview}>Review bid</Button></div>;
}
