import type { Queryable } from "../../infra/database/db.js";
import { netDateTimeOffset, netDecimal, netFingerprint, netGuid, netInt, type NetValue } from "../../utils/dotnet-json.js";
import { enumIndex } from "../../utils/enums.js";
import { NotFoundError, requireRule } from "../../utils/errors.js";
import { Decimal } from "../../utils/money.js";
import { ACCOUNTING_EVENT_TYPES, type AccountingEventType, type BenefitSource, type LedgerSource } from "./ledger.domain.js";

/** µs-precision UTC text for fingerprinted timestamps (JS Dates only hold milliseconds). */
const utcText = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z'`;

/** Every ledger source locks its group row first, the same lock order as the business transaction that produced it. */
export async function lockGroup(db: Queryable, groupId: string): Promise<void> {
  const row = await db.maybeOne(`SELECT "Id" FROM groups."Groups" WHERE "Id" = $1 FOR UPDATE`, [groupId]);
  if (!row) throw new NotFoundError("Group not found.");
}

interface StampInput extends Omit<LedgerSource, "fingerprint"> { occurredAtText: string }

/** LedgerSourceReader.Stamp: SHA-256 of the record serialized by System.Text.Json, with Fingerprint = "". */
function stamp(s: StampInput, decimals: { groupValue: string; winnerPayout: string; platformFee: string; benefits: string[] }): LedgerSource {
  const value: NetValue = {
    EventType: netInt(enumIndex(s.eventType, ACCOUNTING_EVENT_TYPES)), EventId: netGuid(s.eventId), SourceModule: s.sourceModule, GroupId: netGuid(s.groupId),
    CycleId: netGuid(s.cycleId), WinnerMembershipId: s.winnerMembershipId && netGuid(s.winnerMembershipId), SelectionResultId: s.selectionResultId && netGuid(s.selectionResultId),
    AuctionResultId: s.auctionResultId && netGuid(s.auctionResultId), GroupValue: netDecimal(decimals.groupValue), WinnerPayout: netDecimal(decimals.winnerPayout),
    PlatformFee: netDecimal(decimals.platformFee), Benefits: s.benefits.map((b, i) => ({ MembershipId: netGuid(b.membershipId), Amount: netDecimal(decimals.benefits[i] as string) })),
    TimeZone: s.timeZone, OccurredAt: netDateTimeOffset(s.occurredAtText), Fingerprint: "",
  };
  const { occurredAtText: _ignored, ...source } = s;
  return { ...source, fingerprint: netFingerprint(value) };
}

/** ILedgerSourceReader.ReadLockedAsync */
export async function readLedgerSource(db: Queryable, type: AccountingEventType, eventId: string): Promise<LedgerSource> {
  if (type === "ContributionRecorded" || type === "ContributionReversed") {
    const entry = await db.maybeOne<{ EntryType: string; ContributionId: string; CreatedAtText: string; CreatedAt: Date }>(
      `SELECT "EntryType","ContributionId","CreatedAt", ${utcText(`"CreatedAt"`)} AS "CreatedAtText" FROM groups."ContributionEntries" WHERE "Id" = $1`, [eventId]);
    if (!entry) throw new NotFoundError("Contribution event not found.");
    requireRule(entry.EntryType === (type === "ContributionRecorded" ? "Record" : "Reversal"), "INVALID_ACCOUNTING_SOURCE", "Contribution event type does not match.");
    const obligation = await db.one<{ GroupId: string; CycleId: string }>(`SELECT "GroupId","CycleId" FROM groups."Contributions" WHERE "Id" = $1`, [entry.ContributionId]);
    await lockGroup(db, obligation.GroupId);
    const group = await db.one<{ GroupValue: Decimal; GroupTimeZone: string }>(`SELECT "GroupValue","GroupTimeZone" FROM groups."Groups" WHERE "Id" = $1`, [obligation.GroupId]);
    return stamp({ eventType: type, eventId, sourceModule: "Contributions", groupId: obligation.GroupId, cycleId: obligation.CycleId, winnerMembershipId: null, selectionResultId: null,
      auctionResultId: null, groupValue: group.GroupValue, winnerPayout: new Decimal(0), platformFee: new Decimal(0), benefits: [], timeZone: group.GroupTimeZone,
      occurredAt: entry.CreatedAt, occurredAtText: entry.CreatedAtText }, { groupValue: group.GroupValue.toFixed(2), winnerPayout: "0", platformFee: "0", benefits: [] });
  }
  requireRule(["RandomSelectionCompleted", "OrganizerReservedSelectionCompleted", "AuctionSelectionCompleted", "AuctionMemberBenefitCalculated", "PlatformFeeCalculated"].includes(type),
    "UNSUPPORTED_ACCOUNTING_EVENT", "No actual settlement source exists for this accounting event.");
  let selectionId = eventId;
  if (type === "AuctionMemberBenefitCalculated" || type === "PlatformFeeCalculated") {
    const r = await db.maybeOne<{ SelectionResultId: string }>(`SELECT "SelectionResultId" FROM groups."AuctionResults" WHERE "Id" = $1`, [eventId]);
    if (!r) throw new NotFoundError("Auction result not found.");
    selectionId = r.SelectionResultId;
  }
  const selection = await db.maybeOne<{ Id: string; GroupId: string; CycleId: string; SelectionMethod: string; WinnerMembershipId: string; ExecutedAt: Date; ExecutedAtText: string }>(
    `SELECT "Id","GroupId","CycleId","SelectionMethod","WinnerMembershipId","ExecutedAt", ${utcText(`"ExecutedAt"`)} AS "ExecutedAtText" FROM groups."SelectionResults" WHERE "Id" = $1`, [selectionId]);
  if (!selection) throw new NotFoundError("Finalized selection not found.");
  const expected: AccountingEventType = selection.SelectionMethod === "Random" ? "RandomSelectionCompleted" : selection.SelectionMethod === "OrganizerReserved" ? "OrganizerReservedSelectionCompleted" : "AuctionSelectionCompleted";
  requireRule(type === expected || (expected === "AuctionSelectionCompleted" && (type === "AuctionMemberBenefitCalculated" || type === "PlatformFeeCalculated")),
    "INVALID_ACCOUNTING_SOURCE", "Selection method does not match the accounting event.");
  await lockGroup(db, selection.GroupId);
  const group = await db.one<{ GroupTimeZone: string }>(`SELECT "GroupTimeZone" FROM groups."Groups" WHERE "Id" = $1`, [selection.GroupId]);
  const cycle = await db.one<{ SelectionResultId: string | null; SelectionCompletedAt: Date | null; ExpectedPoolAmount: Decimal }>(
    `SELECT "SelectionResultId","SelectionCompletedAt","ExpectedPoolAmount" FROM groups."MonthlyCycles" WHERE "Id" = $1 AND "GroupId" = $2`, [selection.CycleId, selection.GroupId]);
  requireRule(cycle.SelectionResultId === selection.Id && cycle.SelectionCompletedAt !== null, "INVALID_ACCOUNTING_SOURCE", "Cycle has not finalized this selection.");
  if (expected !== "AuctionSelectionCompleted") {
    const pool = cycle.ExpectedPoolAmount.toFixed(2);
    return stamp({ eventType: expected, eventId: selection.Id, sourceModule: "RandomDraws", groupId: selection.GroupId, cycleId: selection.CycleId, winnerMembershipId: selection.WinnerMembershipId,
      selectionResultId: selection.Id, auctionResultId: null, groupValue: cycle.ExpectedPoolAmount, winnerPayout: cycle.ExpectedPoolAmount, platformFee: new Decimal(0), benefits: [],
      timeZone: group.GroupTimeZone, occurredAt: selection.ExecutedAt, occurredAtText: selection.ExecutedAtText }, { groupValue: pool, winnerPayout: pool, platformFee: "0", benefits: [] });
  }
  const result = await db.maybeOne<{ Id: string; CalculationVersion: string; WinnerMembershipId: string; GroupValue: Decimal; WinnerPayout: Decimal; PlatformFee: Decimal; FinalizedAt: Date; FinalizedAtText: string }>(
    `SELECT "Id","CalculationVersion","WinnerMembershipId","GroupValue","WinnerPayout","PlatformFee","FinalizedAt", ${utcText(`"FinalizedAt"`)} AS "FinalizedAtText" FROM groups."AuctionResults" WHERE "SelectionResultId" = $1`, [selection.Id]);
  if (!result) throw new NotFoundError("Finalized auction calculation not found.");
  requireRule(result.CalculationVersion === "DHANVI_AUCTION_V1" && result.WinnerMembershipId === selection.WinnerMembershipId && result.GroupValue.eq(cycle.ExpectedPoolAmount),
    "INVALID_ACCOUNTING_SOURCE", "Unsupported or inconsistent finalized auction calculation.");
  const allocations = await db.query<{ MembershipId: string; Amount: Decimal }>(
    `SELECT "MembershipId","Amount" FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = $1 AND "MembershipId" IS NOT NULL`, [result.Id]);
  // .NET Guid ordering equals ordinal ordering of the lowercase "D" text.
  const benefits: BenefitSource[] = allocations.map((a) => ({ membershipId: a.MembershipId.toLowerCase(), amount: a.Amount }))
    .sort((x, y) => (x.membershipId < y.membershipId ? -1 : x.membershipId > y.membershipId ? 1 : 0));
  return stamp({ eventType: expected, eventId: selection.Id, sourceModule: "Auctions", groupId: selection.GroupId, cycleId: selection.CycleId, winnerMembershipId: result.WinnerMembershipId,
    selectionResultId: selection.Id, auctionResultId: result.Id, groupValue: result.GroupValue, winnerPayout: result.WinnerPayout, platformFee: result.PlatformFee, benefits,
    timeZone: group.GroupTimeZone, occurredAt: result.FinalizedAt, occurredAtText: result.FinalizedAtText },
  { groupValue: result.GroupValue.toFixed(2), winnerPayout: result.WinnerPayout.toFixed(2), platformFee: result.PlatformFee.toFixed(2), benefits: benefits.map((b) => b.amount.toFixed(2)) });
}

export interface CapturedPaymentSource {
  paymentId: string; contributionId: string; groupId: string; cycleId: string; membershipId: string; userId: string; amount: Decimal; timeZone: string;
  capturedAt: Date; providerPaymentId: string; fingerprint: string;
}

/** ICapturedPaymentReader — only a verified TEST capture can post. */
export async function readCapturedPayment(db: Queryable, paymentId: string): Promise<CapturedPaymentSource> {
  const p = await db.one<{ Id: string; ContributionId: string; GroupId: string; CycleId: string; MembershipId: string; UserId: string; Amount: Decimal; BusinessTimeZone: string;
    Status: string; CapturedAt: Date | null; CapturedAtText: string | null; ProviderPaymentId: string | null; Environment: string }>(
    `SELECT "Id","ContributionId","GroupId","CycleId","MembershipId","UserId","Amount","BusinessTimeZone","Status","CapturedAt", ${utcText(`"CapturedAt"`)} AS "CapturedAtText","ProviderPaymentId","Environment"
     FROM payments."Payments" WHERE "Id" = $1`, [paymentId]);
  requireRule(p.Status === "Captured" && p.CapturedAt !== null && p.ProviderPaymentId !== null && p.Environment === "TEST", "PAYMENT_NOT_CAPTURED", "Ledger requires a verified test capture.");
  const fingerprint = netFingerprint({
    PaymentId: netGuid(p.Id), ContributionId: netGuid(p.ContributionId), GroupId: netGuid(p.GroupId), CycleId: netGuid(p.CycleId), MembershipId: netGuid(p.MembershipId),
    UserId: netGuid(p.UserId), Amount: netDecimal(p.Amount.toFixed(2)), TimeZone: p.BusinessTimeZone, CapturedAt: netDateTimeOffset(p.CapturedAtText as string), ProviderPaymentId: p.ProviderPaymentId,
  });
  return { paymentId: p.Id, contributionId: p.ContributionId, groupId: p.GroupId, cycleId: p.CycleId, membershipId: p.MembershipId, userId: p.UserId, amount: p.Amount,
    timeZone: p.BusinessTimeZone, capturedAt: p.CapturedAt, providerPaymentId: p.ProviderPaymentId, fingerprint };
}

export interface SettledPayoutSource {
  id: string; groupId: string; cycleId: string; membershipId: string; selectionResultId: string; auctionResultId: string | null; amount: Decimal; benefit: boolean;
  timeZone: string; actor: string; requestedAt: Date; matchedSuccess: boolean; allocationJournalId: string; fingerprint: string;
}

/** IPayoutLedgerReader — success requires a matched provider success and no unmatched/failed observation on the latest attempt. */
export async function readSettledPayout(db: Queryable, payoutId: string): Promise<SettledPayoutSource> {
  const p = await db.one<{ Id: string; GroupId: string; CycleId: string; MembershipId: string | null; UserId: string | null; SelectionResultId: string; AuctionResultId: string | null;
    Amount: Decimal; PayoutType: string; TimeZone: string; ApprovedByUserId: string | null; CreatedAt: Date; CreatedAtText: string; AllocationJournalId: string }>(
    `SELECT "Id","GroupId","CycleId","MembershipId","UserId","SelectionResultId","AuctionResultId","Amount","PayoutType","TimeZone","ApprovedByUserId","CreatedAt",
       ${utcText(`"CreatedAt"`)} AS "CreatedAtText","AllocationJournalId" FROM payouts."PayoutObligations" WHERE "Id" = $1`, [payoutId]);
  requireRule(p.MembershipId !== null && p.UserId !== null && p.PayoutType !== "PlatformFeeSettlement", "INVALID_PAYOUT_SOURCE", "External settlement requires a member payout.");
  const attempt = await db.maybeOne<{ Id: string; CreatedByUserId: string; RequestedAt: Date; RequestedAtText: string }>(
    `SELECT "Id","CreatedByUserId","RequestedAt", ${utcText(`"RequestedAt"`)} AS "RequestedAtText" FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = $1 ORDER BY "AttemptNumber" DESC LIMIT 1`, [payoutId]);
  let success = false;
  if (attempt) {
    const flags = await db.one<{ ok: boolean; bad: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM payouts."PayoutProviderEvents" WHERE "PayoutAttemptId" = $1 AND "Matched" AND "Status" = 'Success') AS ok,
              EXISTS (SELECT 1 FROM payouts."PayoutProviderEvents" WHERE "PayoutAttemptId" = $1 AND (NOT "Matched" OR "Status" = 'Failed')) AS bad`, [attempt.Id]);
    success = flags.ok && !flags.bad;
  }
  const actor = attempt?.CreatedByUserId ?? p.ApprovedByUserId ?? p.UserId;
  const requestedAtText = attempt?.RequestedAtText ?? p.CreatedAtText;
  const benefit = p.PayoutType === "MemberAuctionBenefit";
  const fingerprint = netFingerprint({
    Id: netGuid(p.Id), GroupId: netGuid(p.GroupId), CycleId: netGuid(p.CycleId), MembershipId: netGuid(p.MembershipId), SelectionResultId: netGuid(p.SelectionResultId),
    AuctionResultId: p.AuctionResultId && netGuid(p.AuctionResultId), Amount: netDecimal(p.Amount.toFixed(2)), Benefit: benefit, TimeZone: p.TimeZone, Actor: netGuid(actor),
    RequestedAt: netDateTimeOffset(requestedAtText), MatchedSuccess: success, AllocationJournalId: netGuid(p.AllocationJournalId),
  });
  return { id: p.Id, groupId: p.GroupId, cycleId: p.CycleId, membershipId: p.MembershipId, selectionResultId: p.SelectionResultId, auctionResultId: p.AuctionResultId, amount: p.Amount,
    benefit, timeZone: p.TimeZone, actor, requestedAt: attempt?.RequestedAt ?? p.CreatedAt, matchedSuccess: success, allocationJournalId: p.AllocationJournalId, fingerprint };
}
