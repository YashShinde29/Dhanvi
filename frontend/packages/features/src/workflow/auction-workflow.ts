import type { Auction, Group } from "@dhanvi/types";
import { formatDateTime, formatMoney, humanize, statusGuidance } from "@dhanvi/utils";
import type { WorkflowStep, WorkflowSummary } from "./workflow-status";

const REASONS: Record<string, string> = {
  ALREADY_SELECTED: "You have already received your main payout.", ALREADY_SELECTED_FOR_PAYOUT: "You have already received your main payout.",
  NOT_ACTIVE_MEMBER: "You are not an active member of this group.", AUCTION_NOT_OPEN: "The auction is not open right now.",
  CONTRIBUTION_PENDING: "Your contribution for this cycle is not complete.", ORGANIZER_NOT_PARTICIPATING: "Organizers who do not participate cannot bid.",
};
export const bidUnavailableReason = (code: string | null) => (code ? REASONS[code] ?? humanize(code) : null);

export function auctionSteps(a: Auction): WorkflowStep[] {
  const rank = a.status === "SCHEDULED" ? 0 : a.status === "OPEN" ? 1 : a.status === "CLOSED" ? 2 : 3;
  const s = (i: number, cur: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (i < rank ? "complete" : i === rank ? cur : "upcoming");
  return [
    { id: "scheduled", label: "Scheduled", state: s(0, "waiting") }, { id: "open", label: "Bidding open", state: s(1) },
    { id: "closed", label: "Closed", state: s(2, "waiting") }, { id: "result", label: a.status === "CLOSED_NO_BIDS" ? "No bids" : "Winner decided", state: a.status === "CLOSED_NO_BIDS" ? "blocked" : rank >= 3 ? "complete" : "upcoming" },
  ];
}

export function auctionSummary(a: Auction, group: Group, viewer: "member" | "organizer" | "admin", canManage: boolean): WorkflowSummary {
  const g = statusGuidance("auction", a.status);
  const when = (v: string) => formatDateTime(v, group.groupTimeZone);
  const steps = auctionSteps(a);
  switch (a.status) {
    case "SCHEDULED": {
      const operator = group.creatorType === "PLATFORM" ? "Dhanvi admin" : "the organizer";
      return { stage: g.stage, status: canManage && a.canOpen ? "attention" : "waiting", headline: `Starts ${when(a.startsAt)} · closes ${when(a.endsAt)}.`, detail: viewer === "member" ? "No action is required yet." : undefined, steps,
        responsibleRole: canManage && !a.canOpen ? "SYSTEM" : "ORGANIZER", waitingFor: canManage && a.canOpen ? undefined : canManage ? "the scheduled auction window (server-enforced)" : `${operator} to open the auction`,
        next: "Eligible members bid a discount; the highest valid discount wins.", action: canManage && a.canOpen ? { title: "Open the auction", status: "attention", responsibleRole: "ORGANIZER", actionLabel: "Open auction", onAction: undefined } : undefined };
    }
    case "OPEN": return { stage: g.stage, status: a.canBid ? "attention" : "current", headline: a.bidCount ? `Current highest discount ${formatMoney(a.currentHighestDiscount)} · minimum next bid ${formatMoney(a.minimumNextBid)}.` : `No bids yet · minimum bid ${formatMoney(a.minimumNextBid)}.`, detail: a.canBid ? "You are eligible to bid." : viewer === "member" ? `You cannot bid in this cycle.${bidUnavailableReason(a.bidUnavailableReason) ? ` Reason: ${bidUnavailableReason(a.bidUnavailableReason)}` : ""}` : `${a.eligibleBidderCount} eligible bidders · closes ${when(a.endsAt)}.`, steps, responsibleRole: a.canBid ? "USER" : canManage && a.canClose ? "ORGANIZER" : "USER", next: `Closes ${when(a.endsAt)}. The organizer then finalises the winner.`, blockedBy: !a.canBid && viewer === "member" ? bidUnavailableReason(a.bidUnavailableReason) ?? undefined : undefined };
    case "CLOSED": return { stage: g.stage, status: "waiting", headline: "Bidding has ended.", steps, responsibleRole: "SYSTEM", waitingFor: "the result to be finalised" };
    case "WINNER_SELECTED": return { stage: "Auction completed", status: "complete", headline: a.result ? `Winner: Member #${a.result.winner.slotNumber} — ${a.result.winner.displayName} · winning discount ${formatMoney(a.result.winningDiscount)}.` : "The winner has been decided.", steps, responsibleRole: "ADMIN", next: "Payout processing." };
    case "CLOSED_NO_BIDS": return { stage: g.stage, status: "blocked", headline: "No winner or payout right was assigned.", steps, blockedBy: "The auction closed without any bids. The cycle needs organizer review.", responsibleRole: "ORGANIZER" };
    default: return { stage: g.stage, status: "current", headline: g.description, steps };
  }
}
