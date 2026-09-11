"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { auctionService } from "@/services/auction.service";
import type { GroupScope } from "@/services/group.service";
import type { Auction, AuctionBid } from "@/types/auction";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Fact, KeyValueRows } from "@/components/ui/description";
import { FormField, MoneyInput } from "@/components/ui/form";
import { Icons } from "@/components/ui/icons";
import { SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatMoney, formatSignedMoney, humanize } from "@/lib/format";
import { AuctionResultCard } from "./auction-result";

// Input validation and payout preview use integer paise, with no rounded allocations.
function paise(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
function exactMoney(value: bigint): string {
  const rupees = value / BigInt(100), rest = value % BigInt(100);
  return rest === BigInt(0) ? `₹${new Intl.NumberFormat("en-IN").format(rupees)}` : `₹${new Intl.NumberFormat("en-IN").format(rupees)}.${rest.toString().padStart(2, "0")}`;
}

export function AuctionPanel({ group, cycle, scope }: { group: Group; cycle: MonthlyCycle; scope: GroupScope }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Auction>();
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ amount: string; key: string } | null>(null);
  const canManageScope = scope === "organizer" || scope === "admin";

  useEffect(() => {
    let active = true;
    let fetching = false;
    async function poll() {
      if (fetching || busy) return;
      fetching = true;
      try {
        const auction = await auctionService.get(group.id, cycle.id);
        if (active) { setData(auction); setError(""); }
      } catch (e) {
        if (active) setError(friendlyError(e));
      } finally { fetching = false; }
    }
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [group.id, cycle.id, busy]);

  const when = (value: string) => formatDateTime(value, group.groupTimeZone);
  const amount = paise(discount);
  const value = paise(group.groupValue.toString());
  const validShare = amount !== null && amount > BigInt(0) && amount % BigInt(group.memberLimit) === BigInt(0);
  const payout = validShare && value !== null && amount < value ? value - amount : null;
  const minimum = data ? paise(data.minimumNextBid.toString()) : null;
  const maximum = data ? paise(data.maximumDiscount.toString()) : null;
  const validBid = payout !== null && amount !== null && minimum !== null && maximum !== null && amount >= minimum && amount <= maximum;
  const maxReached = !!data && data.minimumNextBid > data.maximumDiscount;

  function bidHint(): string | null {
    if (!discount) return null;
    if (amount === null) return "Enter a whole rupee amount or up to two decimal places.";
    if (!validShare) return `The discount must divide exactly among all ${group.memberLimit} members so no allocation is rounded.`;
    if (payout === null) return "The discount must be less than the group value.";
    if (minimum !== null && amount < minimum) return `Minimum next discount is ${formatMoney(data!.minimumNextBid)}.`;
    if (maximum !== null && amount > maximum) return `Maximum discount for this group is ${formatMoney(data!.maximumDiscount)}.`;
    return null;
  }

  async function refresh() {
    setError("");
    try { setData(await auctionService.get(group.id, cycle.id)); } catch (e) { setError(friendlyError(e)); }
  }

  async function manage(action: "open" | "close") {
    if (!canManageScope) return;
    const result = await confirm(action === "open"
      ? { title: `Open the cycle ${cycle.cycleNumber} auction?`, description: "Eligible members can place discount bids until the auction closes. The server enforces the scheduled window.", confirmLabel: "Open auction" }
      : { title: "Close and finalize this auction?", description: "The highest valid discount determines the payout right for this cycle. If no bids exist, the cycle remains unresolved. No actual payout is processed.", confirmLabel: "Close auction", variant: "danger" });
    if (!result.confirmed) return;
    setBusy(true); setError("");
    try { setData(await auctionService.manage(scope, group.id, cycle.id, action)); toast.success(action === "open" ? "Auction opened" : "Auction closed"); }
    catch (e) { toast.error(action === "open" ? "Couldn't open auction" : "Couldn't close auction", friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function bid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canBid || !validBid || amount === null || payout === null || busy) return;
    const result = await confirm({
      title: `Confirm your discount bid of ${exactMoney(amount)}?`,
      description: `If this is the winning discount, your payout right will be ${exactMoney(payout)} before actual payout processing.`,
      details: <KeyValueRows items={[{ key: "Group value", value: formatMoney(group.groupValue) }, { key: "Your discount", value: formatSignedMoney(Number(amount) / 100, "-") }]} total={{ key: "Potential payout right", value: exactMoney(payout) }} />,
      confirmLabel: "Submit discount bid",
    });
    if (!result.confirmed) return;
    setBusy(true); setError("");
    if (pending.current?.amount !== discount) pending.current = { amount: discount, key: crypto.randomUUID() };
    try {
      const accepted = await auctionService.bid(group.id, cycle.id, discount, pending.current.key);
      pending.current = null;
      toast.success("Discount bid submitted", `Bid #${accepted.sequenceNumber}: ${formatMoney(accepted.discountAmount)} discount.`);
      setDiscount("");
      setData(await auctionService.get(group.id, cycle.id));
    } catch (e) { toast.error("Bid not submitted", friendlyError(e)); }
    finally { setBusy(false); }
  }

  const bidColumns = (operational: boolean): Column<AuctionBid>[] => [
    { key: "seq", header: "Bid", primary: true, render: (b) => <span className="text-strong">#{b.sequenceNumber}{operational && b.memberSlot !== null ? ` · Member #${b.memberSlot}` : ""}</span> },
    { key: "discount", header: "Discount", align: "right", render: (b) => <span className="amount">{formatMoney(b.discountAmount)}</span> },
    { key: "payout", header: "Potential payout", align: "right", render: (b) => <span className="amount" style={{ fontWeight: 500 }}>{formatMoney(b.potentialWinnerPayout)}</span> },
    { key: "time", header: "Submitted", render: (b) => when(b.submittedAt) },
    { key: "status", header: "Status", render: (b) => b.isCurrentWinningBid ? <Badge tone="success">Highest discount</Badge> : <Badge tone="neutral" plain>Outbid</Badge> },
  ];

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return <Card><CardHeader title={`Cycle ${cycle.cycleNumber} auction`} /><CardBody><SkeletonText lines={4} /></CardBody></Card>;

  return (
    <div className="stack stack--lg">
      <Card>
        <CardHeader
          title={<span className="row" style={{ gap: 8 }}><Icons.Gavel size={18} style={{ color: "var(--color-type-auction)" }} /> Cycle {cycle.cycleNumber} auction</span>}
          subtitle={data.status === "OPEN" ? `Closes ${when(data.endsAt)}` : data.status === "SCHEDULED" ? `Opens ${when(data.startsAt)} · closes ${when(data.endsAt)}` : data.closedAt ? `Closed ${when(data.closedAt)}` : `Window ${when(data.startsAt)} – ${when(data.endsAt)}`}
          actions={<><StatusBadge kind="auction" value={data.status} size="lg" /><Button variant="ghost" size="sm" iconOnly icon={<Icons.Refresh size={16} />} onClick={refresh} disabled={busy}>Refresh auction</Button></>} />
        <CardBody className="stack stack--lg">
          {error && <Callout variant="danger">{error}</Callout>}
          <div className="auction-head">
            <div className="stat stat--compact"><span className="stat__label">Group value</span><span className="stat__value stat__value--money amount">{formatMoney(group.groupValue)}</span></div>
            <div className="stat stat--compact"><span className="stat__label">Current highest discount</span><span className="stat__value stat__value--money amount">{data.bidCount ? formatMoney(data.currentHighestDiscount) : "—"}</span><span className="stat__hint">{data.bidCount} bid{data.bidCount === 1 ? "" : "s"} · {data.eligibleBidderCount} eligible members</span></div>
            <div className="stat stat--compact"><span className="stat__label">Current potential payout</span><span className="stat__value stat__value--money amount">{data.bidCount ? formatMoney(data.potentialWinnerPayout) : formatMoney(group.groupValue)}</span><span className="stat__hint">Minimum next discount: {maxReached ? "maximum reached" : formatMoney(data.minimumNextBid)}</span></div>
          </div>
          <div className="grid-3" style={{ gap: 12 }}>
            <Fact label="Minimum discount" value={formatMoney(data.minimumDiscount)} />
            <Fact label="Maximum discount" value={formatMoney(data.maximumDiscount)} />
            <Fact label="Bid increment" value={formatMoney(data.bidIncrement)} />
          </div>
          <p className="text-xs text-muted">Last server update {when(data.serverTime)}. Auction times are enforced by the server in {group.groupTimeZone}.</p>
          {canManageScope && data.canManage && (data.canOpen || data.canClose) && (
            <div className="row">
              {data.canOpen && <Button loading={busy} onClick={() => manage("open")} icon={<Icons.Play size={16} />}>Open auction</Button>}
              {data.canClose && <Button variant="danger-outline" loading={busy} onClick={() => manage("close")} icon={<Icons.Lock size={16} />}>Close and finalize auction</Button>}
            </div>
          )}
          {data.status === "CLOSED_NO_BIDS" && <Callout variant="warning" title="Closed with no bids">No winner or payout right was assigned. The cycle remains unresolved and requires organizer review.</Callout>}
        </CardBody>
      </Card>

      {data.result ? <AuctionResultCard result={data.result} timeZone={group.groupTimeZone} /> : data.canBid ? (
        <Card>
          <CardHeader title="Place your discount bid" subtitle="Offer the discount you'd accept on the payout. A higher discount wins the cycle." />
          <CardBody>
            <form onSubmit={bid} className="stack" noValidate>
              <FormField label="Your discount" htmlFor={`auction-discount-${cycle.id}`} required error={bidHint() ?? undefined} help={!discount ? `Between ${formatMoney(data.minimumNextBid)} and ${formatMoney(data.maximumDiscount)}, divisible by ${group.memberLimit} members.` : undefined}>
                <MoneyInput id={`auction-discount-${cycle.id}`} value={discount} onChange={setDiscount} disabled={busy} invalid={!!discount && !validBid} placeholder="0" aria-describedby={`auction-preview-${cycle.id}`} style={{ maxWidth: 320 }} />
              </FormField>
              <div id={`auction-preview-${cycle.id}`} className="auction-preview" aria-live="polite">
                <Fact label="Discount" value={amount !== null && discount ? exactMoney(amount) : "—"} large />
                <Fact label="Potential payout · if this wins" value={payout !== null ? exactMoney(payout) : "—"} large />
              </div>
              <div className="row"><Button type="submit" loading={busy} disabled={!validBid} icon={<Icons.Gavel size={16} />}>Submit discount bid</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : data.bidUnavailableReason ? <Callout variant="neutral">{humanize(data.bidUnavailableReason)}</Callout> : null}

      <div className="section">
        <div className="section__header"><h3 className="h-section">Your bids</h3></div>
        <DataTable columns={bidColumns(false)} rows={data.myBids} rowKey={(b) => b.bidId} caption="Your bid history" empty={{ title: "No bids yet", description: data.canBid ? "Your submitted discount bids will appear here." : "You haven't placed a bid in this auction." }} />
      </div>

      {canManageScope && (data.canManage || data.operationalBids.length > 0 || data.auditHistory.length > 0) && (
        <details className="disclosure">
          <summary>Auction operations &amp; audit history</summary>
          <div className="disclosure__body">
            <DataTable columns={bidColumns(true)} rows={data.operationalBids} rowKey={(b) => b.bidId} caption="All bids" compact empty={{ title: "No bids recorded" }} />
            {data.auditHistory.length > 0 && (
              <ul className="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {data.auditHistory.map((event, i) => <li key={`${event.action}-${i}`} className="list__item"><span className="list__text"><span className="list__title">{humanize(event.action)}</span></span><span className="list__end text-muted">{when(event.createdAt)}</span></li>)}
              </ul>
            )}
          </div>
        </details>
      )}
      {scope === "public" && <p className="text-xs text-muted"><Link className="link" href={`/groups/${group.id}`}>Back to group</Link></p>}
    </div>
  );
}
