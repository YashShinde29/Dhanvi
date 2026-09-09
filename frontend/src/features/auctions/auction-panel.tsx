"use client";
import { useEffect, useRef, useState } from "react";
import { auctionService } from "@/services/auction.service";
import { errorText, label, money } from "@/features/groups/shared";
import type { Auction, AuctionBid } from "@/types/auction";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";

// Input validation and payout preview use integer paise, with no rounded allocations.
function paise(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
function exactMoney(value: bigint): string {
  return `₹${new Intl.NumberFormat("en-IN").format(value / BigInt(100))}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
export function AuctionPanel({ group, cycle, scope }: { group: Group; cycle: MonthlyCycle; scope: string }) {
  const [data, setData] = useState<Auction>();
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ amount: string; key: string } | null>(null);
  const canManageScope = scope === "organizer" || scope === "admin";

  useEffect(() => {
    let active = true;
    let fetching = false;
    async function refresh() {
      if (fetching || busy) return;
      fetching = true;
      try {
        const auction = await auctionService.get(group.id, cycle.id);
        if (active) setData(auction);
      } catch (e) {
        if (active) setError(errorText(e));
      } finally { fetching = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [group.id, cycle.id, busy]);

  const date = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: group.groupTimeZone });
  const amount = paise(discount);
  const value = paise(group.groupValue.toString());
  const validShare = amount !== null && amount > BigInt(0) && amount % BigInt(group.memberLimit) === BigInt(0);
  const payout = validShare && value !== null && amount < value ? value - amount : null;
  const minimum = data ? paise(data.minimumNextBid.toString()) : null;
  const maximum = data ? paise(data.maximumDiscount.toString()) : null;
  const validBid = payout !== null && amount !== null && minimum !== null && maximum !== null && amount >= minimum && amount <= maximum;

  async function refresh() {
    setError("");
    try { setData(await auctionService.get(group.id, cycle.id)); }
    catch (e) { setError(errorText(e)); }
  }
  async function manage(action: "open" | "close") {
    if (!canManageScope) return;
    if (action === "close" && !window.confirm("Close this auction now? The highest valid discount determines the final payout right. If no bids exist, the cycle remains unresolved. No actual payout is processed.")) return;
    setBusy(true); setError(""); setMessage("");
    try { setData(await auctionService.manage(scope, group.id, cycle.id, action)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function bid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canBid || !validBid || amount === null || payout === null) return;
    if (!window.confirm(`You are bidding a discount of ${exactMoney(amount)}. If this becomes the winning bid, your payout right will be ${exactMoney(payout)} before actual payout processing.`)) return;
    setBusy(true); setError(""); setMessage("");
    if (pending.current?.amount !== discount) pending.current = { amount: discount, key: crypto.randomUUID() };
    try {
      const accepted = await auctionService.bid(group.id, cycle.id, discount, pending.current.key);
      pending.current = null;
      setMessage(`Bid #${accepted.sequenceNumber} recorded: ${money(accepted.discountAmount)} discount.`);
      setDiscount("");
      setData(await auctionService.get(group.id, cycle.id));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  function history(bids: AuctionBid[], operational = false) {
    return bids.length === 0 ? <p>No bids recorded.</p> : (
      <div className="table-wrap"><table>
        <thead><tr><th>Sequence</th>{operational && <th>Member</th>}<th>Discount</th><th>Potential payout right</th><th>Submitted ({group.groupTimeZone})</th><th>Status</th></tr></thead>
        <tbody>{bids.map((b) => <tr key={b.bidId}><td>{b.sequenceNumber}</td>{operational && <td>#{b.memberSlot}</td>}<td>{money(b.discountAmount)}</td><td>{money(b.potentialWinnerPayout)}</td><td>{date(b.submittedAt)}</td><td>{b.isCurrentWinningBid ? "Highest discount" : "Earlier bid"}</td></tr>)}</tbody>
      </table></div>
    );
  }

  return <section className="selection-panel">
    <h3>{data?.result ? "Auction Completed" : `Auction · Cycle ${cycle.cycleNumber}`}</h3>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button className="button secondary" disabled={busy} onClick={refresh}>Refresh auction</button>
    {!data ? <p>Loading auction…</p> : <>
      <p>Status: {label(data.status)} · {data.bidCount} bids · {data.eligibleBidderCount} eligible members</p>
      <p>Opening: {date(data.startsAt)} · Closing: {date(data.endsAt)} ({group.groupTimeZone})</p>
      <p>Last server update: {date(data.serverTime)}. Auction times are enforced by the server.</p>
      <dl>
        <dt>Minimum discount</dt><dd>{money(data.minimumDiscount)}</dd>
        <dt>Maximum discount</dt><dd>{money(data.maximumDiscount)}</dd>
        <dt>Bid increment</dt><dd>{money(data.bidIncrement)}</dd>
        <dt>Current highest discount</dt><dd>{money(data.currentHighestDiscount)}</dd>
        <dt>Minimum next bid</dt><dd>{data.minimumNextBid > data.maximumDiscount ? "Maximum discount reached" : money(data.minimumNextBid)}</dd>
      </dl>
      {canManageScope && data.canManage && <div className="form-actions">
        {data.canOpen && <button className="button" disabled={busy} onClick={() => manage("open")}>Open auction</button>}
        {data.canClose && <button className="button" disabled={busy} onClick={() => manage("close")}>Close and finalize auction</button>}
      </div>}
      {data.status === "CLOSED_NO_BIDS" && <p className="status-note">Closed with no bids. No winner or payout right was assigned. The cycle remains unresolved and requires organizer review.</p>}
      {data.result ? <>
        <dl>
          <dt>Winning Member</dt><dd>#{data.result.winner.slotNumber} · {data.result.winner.displayName}</dd>
          <dt>Group Value</dt><dd>{money(data.result.groupValue)}</dd>
          <dt>Winning Discount</dt><dd>{money(data.result.winningDiscount)}</dd>
          <dt>Winner Payout Right</dt><dd>{money(data.result.winnerPayout)}</dd>
          <dt>Benefit Per Other Member</dt><dd>{money(data.result.grossMemberShare)}</dd>
          <dt>Total Member Benefit</dt><dd>{money(data.result.memberBenefitPool)} across {data.result.nonWinnerCount} members</dd>
          <dt>Proposed Platform Service Fee</dt><dd>{money(data.result.platformFee)}</dd>
        </dl>
        <p><strong>Pending Payout</strong>. No actual payout has been processed yet.</p>
        <p>Member benefits and the proposed fee are calculated allocations, pending settlement.</p>
        {data.result.myBenefitAllocation !== null && <p>Your calculated benefit: {money(data.result.myBenefitAllocation)}</p>}
        <p>Finalized {date(data.result.finalizedAt)} · {data.result.calculationVersion}</p>
      </> : data.canBid ? <form onSubmit={bid}>
        <label htmlFor={`auction-discount-${cycle.id}`}>Discount amount (₹)</label>
        <input id={`auction-discount-${cycle.id}`} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={busy} required aria-describedby={`auction-preview-${cycle.id}`} />
        <p id={`auction-preview-${cycle.id}`}>{payout !== null ? `Potential payout right if your bid wins: ${exactMoney(payout)}` : "Enter a positive discount with at most two decimal places that divides exactly among all member positions."}</p>
        {discount && !validBid && <p>Meet the minimum next bid and maximum discount. No member allocation will be rounded.</p>}
        <button className="button" type="submit" disabled={busy || !validBid}>{busy ? "Submitting…" : "Place Bid"}</button>
      </form> : <p>{data.bidUnavailableReason}</p>}
      <h4>Your bid history</h4>{history(data.myBids)}
      {(data.canManage || data.operationalBids.length > 0 || data.auditHistory.length > 0) && <details>
        <summary>Auction operations and audit history</summary>
        {history(data.operationalBids, true)}
        <ul>{data.auditHistory.map((event, i) => <li key={`${event.action}-${i}`}>{label(event.action)} · {date(event.createdAt)}</li>)}</ul>
      </details>}
    </>}
  </section>;
}
