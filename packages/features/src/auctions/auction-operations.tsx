"use client";
import Link from "next/link";
import { useState } from "react";
import type { AuctionBid, Group, MonthlyCycle } from "@dhanvi/types";
import { auctionService } from "@dhanvi/api-client";
import { Breadcrumbs, Button, Card, CardBody, CardHeader, ControlPanel, DataTable, type Column, ErrorState, LinkButton, SkeletonText, useConfirm, useToast } from "@dhanvi/ui";
import { formatDateTime, formatMoney, formatTime, friendlyError, humanize } from "@dhanvi/utils";
import { countdown, screenPhase } from "./auction-model";
import { useLiveAuction, useTicker } from "./use-live-auction";
import { AuctionExperience } from "./auction-experience";

interface Props { group: Group; cycle: MonthlyCycle; scope: "admin" | "organizer"; groupHref: string; listHref: string; listLabel: string }

/**
 * Auction operations for the operator (Dhanvi admin for platform groups, organizer for own groups). No bidding here:
 * status, window, counts, leader, one primary action per state, and the operational bid table. An organizer who
 * also participates gets the member experience underneath, clearly separated from the controls.
 */
export function AuctionOperations({ group, cycle, scope, groupHref, listHref, listLabel }: Props) {
  const { auction, error, refresh, setAuction, serverNow } = useLiveAuction(group.id, cycle.id);
  const toast = useToast(); const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const phase = auction ? screenPhase(auction) : undefined;
  useTicker(phase === "LIVE" || phase === "SCHEDULED");
  const crumbs = [{ label: listLabel, href: listHref }, { label: group.name, href: groupHref }, { label: `Cycle ${cycle.cycleNumber} auction` }];
  if (error && !auction) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={refresh} /></div>;
  if (!auction) return <div className="stack"><Breadcrumbs items={crumbs} /><Card><CardBody><SkeletonText lines={4} /></CardBody></Card></div>;
  const a = auction; const zone = group.groupTimeZone; const now = serverNow();

  async function manage(action: "open" | "close") {
    const r = await confirm(action === "open"
      ? { title: "Open the auction?", description: "Eligible members can place discount bids until it closes. The server enforces the scheduled window.", confirmLabel: "Open auction" }
      : { title: "Close and finalize the auction?", description: `${a.bidCount ? `The highest valid discount (${formatMoney(a.currentHighestDiscount)}) decides this cycle's payout right.` : "There are no bids: the cycle stays unresolved."} This cannot be undone.`, confirmLabel: "Close auction", variant: "danger" });
    if (!r.confirmed) return;
    setBusy(true);
    try { setAuction(await auctionService.manage(scope, group.id, cycle.id, action)); toast.success(action === "open" ? "Auction opened ✓" : "Auction closed ✓", action === "open" ? "Next: eligible members bid until it closes." : `Next: ${scope === "admin" ? "prepare the winner's payout." : "Dhanvi prepares the winner's payout."}`); }
    catch (e) { toast.error(action === "open" ? "Couldn't open auction" : "Couldn't close auction", friendlyError(e)); }
    finally { setBusy(false); }
  }

  const stage = phase === "SCHEDULED" ? "Scheduled" : phase === "LIVE" ? "Open · bidding" : phase === "CLOSING" ? "Closed · finalizing" : phase === "NO_BIDS" ? "Closed without bids" : "Completed";
  const status = phase === "LIVE" ? (a.canManage && a.canClose ? "attention" : "current") : phase === "SCHEDULED" ? (a.canOpen ? "attention" : "waiting") : phase === "COMPLETED" ? "complete" : phase === "NO_BIDS" ? "blocked" : "waiting";
  const primary = !a.canManage ? undefined : phase === "SCHEDULED" && a.canOpen ? <Button loading={busy} onClick={() => manage("open")}>Open auction</Button>
    : phase === "LIVE" && a.canClose ? <Button loading={busy} variant="danger" onClick={() => manage("close")}>Close auction</Button>
    : phase === "COMPLETED" ? <LinkButton href={`${groupHref}?tab=payouts`} variant="secondary">View result &amp; payouts</LinkButton> : undefined;
  const facts = [
    { label: "Window", value: `${formatDateTime(a.startsAt, zone)} → ${formatDateTime(a.endsAt, zone)}` },
    ...(phase === "SCHEDULED" ? [{ label: "Opens in", value: countdown(new Date(a.startsAt).getTime() - now) ?? "Window open — can be opened now" }] : []),
    ...(phase === "LIVE" ? [{ label: "Time left", value: countdown(new Date(a.endsAt).getTime() - now) ?? "Past scheduled end — close when ready" }] : []),
    ...(!a.canManage ? [{ label: "Who acts", value: group.creatorType === "PLATFORM" ? "Dhanvi admin" : "The organizer", tone: "waiting" as const }] : []),
    ...(phase === "SCHEDULED" && a.canManage && !a.canOpen ? [{ label: "Waiting on", value: cycle.status !== "READY_FOR_SELECTION" ? "all contributions to settle" : "the scheduled window (server-enforced)", tone: "waiting" as const }] : []),
    ...(phase === "NO_BIDS" ? [{ label: "Blocked by", value: "No bids were placed; no payout right was assigned.", tone: "blocked" as const }] : []),
  ];
  const columns: Column<AuctionBid>[] = [
    { key: "seq", header: "Seq", render: (b) => <span className="num">#{b.sequenceNumber}</span> },
    { key: "member", header: "Member", primary: true, render: (b) => `Member ${b.memberSlot ?? "—"}` },
    { key: "discount", header: "Discount", align: "right", render: (b) => <span className="amount">{formatMoney(b.discountAmount)}</span> },
    { key: "payout", header: "Payout if wins", align: "right", render: (b) => <span className="amount">{formatMoney(b.potentialWinnerPayout)}</span> },
    { key: "time", header: "Time", render: (b) => formatTime(b.submittedAt, zone) },
    { key: "status", header: "Status", render: (b) => b.isCurrentWinningBid ? <span className="badge badge--success">{phase === "COMPLETED" ? "Winning" : "Highest"}</span> : <span className="badge badge--neutral badge--plain">Outbid</span> },
  ];
  return (
    <div className="stack stack--lg">
      <Breadcrumbs items={crumbs} />
      <div className="auc__head"><div><div className="auc__eyebrow">{group.name} · Cycle {cycle.cycleNumber} of {group.durationMonths}</div><h1 className="auc__title">Auction operations</h1></div><span className={`auc__pill ${phase === "LIVE" ? "auc__pill--live" : phase === "COMPLETED" ? "auc__pill--done" : ""}`}>{humanize(a.status)}</span></div>
      <ControlPanel eyebrow="Auction control" stage={stage} status={status} headline={a.bidCount ? `Current highest discount ${formatMoney(a.currentHighestDiscount)} · projected winner payout ${formatMoney(a.potentialWinnerPayout)}` : "No bids yet."} facts={facts} primary={primary}>
        <dl className="auc__ops-grid">
          <div className="auc__fact"><dt>Eligible members</dt><dd>{a.eligibleBidderCount}</dd></div><div className="auc__fact"><dt>Total bids</dt><dd>{a.bidCount}</dd></div>
          <div className="auc__fact"><dt>Current highest</dt><dd className="amount">{a.bidCount ? formatMoney(a.currentHighestDiscount) : "—"}</dd></div><div className="auc__fact"><dt>Projected payout</dt><dd className="amount">{formatMoney(a.bidCount ? a.potentialWinnerPayout : a.groupValue)}</dd></div>
          <div className="auc__fact"><dt>Current leader</dt><dd>{a.currentLeaderSlot ? `Member ${a.currentLeaderSlot}` : "—"}</dd></div><div className="auc__fact"><dt>Group value</dt><dd className="amount">{formatMoney(a.groupValue)}</dd></div>
        </dl>
        {phase === "CLOSING" && <p className="text-sm text-secondary" style={{ margin: 0 }}>Finalizing… the result is recorded by the server.</p>}
        {phase === "COMPLETED" && a.result && <p className="text-sm text-secondary" style={{ margin: 0 }}>Winner: Member {a.result.winner.slotNumber} — {a.result.winner.displayName} · winning discount {formatMoney(a.result.winningDiscount)} · payout {formatMoney(a.result.winnerPayout)} · member benefit pool {formatMoney(a.result.memberBenefitPool)} · platform fee {formatMoney(a.result.platformFee)}.</p>}
      </ControlPanel>
      <Card>
        <CardHeader title="Bid monitoring" subtitle={`Min ${formatMoney(a.minimumDiscount)} · max ${formatMoney(a.maximumDiscount)} · increment ${formatMoney(a.bidIncrement)} · last server update ${formatTime(a.serverTime, zone)}`} />
        <DataTable columns={columns} rows={[...a.operationalBids].reverse()} rowKey={(b) => b.bidId} compact empty={{ title: "No bids recorded", description: phase === "SCHEDULED" ? "Bids appear once the auction is open." : "No member has bid yet." }} />
      </Card>
      {a.auditHistory.length > 0 && <details className="disclosure"><summary>Audit history</summary><div className="disclosure__body"><ul className="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>{a.auditHistory.map((e, i) => <li key={`${e.action}-${i}`} className="list__item"><span className="list__text"><span className="list__title">{humanize(e.action)}</span></span><span className="list__end text-muted">{formatDateTime(e.createdAt, zone)}</span></li>)}</ul></div></details>}
      <p className="text-sm text-muted"><Link className="link" href={groupHref}>Back to group</Link></p>
    </div>
  );
}

/** Organizer who is also an eligible participant: controls first, own participation below, never mixed. */
export function OrganizerAuctionPage({ group, cycle }: { group: Group; cycle: MonthlyCycle }) {
  const participates = group.organizerParticipates && group.myMembership?.status === "ACTIVE";
  return (
    <div className="stack stack--lg">
      <AuctionOperations group={group} cycle={cycle} scope="organizer" groupHref={`/organizer/groups/${group.id}`} listHref="/organizer/groups" listLabel="My managed groups" />
      {participates && (
        <section className="stack" aria-label="Your participation">
          <div className="section__header"><h2 className="h-section">Your participation</h2><span className="text-sm text-muted">You also save in this group; bidding here is separate from the controls above.</span></div>
          <AuctionExperience group={group} cycle={cycle} groupHref={`/groups/${group.id}`} payoutsHref="/payouts" participant />
        </section>
      )}
    </div>
  );
}
