import type { FeeRecognitionPolicy } from "../../config/payment.js";
import { businessToday, type DateOnly } from "../../utils/dates.js";
import { requireRule } from "../../utils/errors.js";
import { Decimal, isPaise, MAX_AMOUNT, sum } from "../../utils/money.js";

/** Stored as EF enum names; ordinals matter only inside .NET-format fingerprints. */
export const ACCOUNTING_EVENT_TYPES = [
  "ContributionRecorded", "ContributionReversed", "RandomSelectionCompleted", "OrganizerReservedSelectionCompleted",
  "AuctionSelectionCompleted", "AuctionMemberBenefitCalculated", "PlatformFeeCalculated", "AccountingReversal",
  // Reserved vocabulary in .NET (PaymentReceived unused); PaymentCaptured and PayoutSettled are posted.
  "PaymentReceived", "PaymentCaptured", "PayoutSettled",
] as const;
export type AccountingEventType = (typeof ACCOUNTING_EVENT_TYPES)[number];

export const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type NormalBalance = "Debit" | "Credit";

export const Accounts = {
  CashClearing: "1000", PaymentGatewayClearing: "1010", PayoutGatewayClearing: "1020", MemberReceivable: "1100", PlatformFeeReceivable: "1200",
  GroupPool: "2000", MemberPayout: "2100", MemberBenefit: "2200", DeferredPlatformFee: "2300", ServiceFeeRevenue: "4000",
} as const;

export const SYSTEM_ACCOUNTS: ReadonlyArray<{ code: string; name: string; type: AccountType }> = [
  { code: "1000", name: "Cash clearing (future settlement)", type: "Asset" },
  { code: "1010", name: "Razorpay test payment gateway clearing", type: "Asset" },
  { code: "1020", name: "Test payout gateway clearing", type: "Asset" },
  { code: "1100", name: "Member receivable", type: "Asset" },
  { code: "1200", name: "Platform fee receivable", type: "Asset" },
  { code: "2000", name: "Group pool liability", type: "Liability" },
  { code: "2100", name: "Member payout liability", type: "Liability" },
  { code: "2200", name: "Member auction benefit liability", type: "Liability" },
  { code: "2300", name: "Deferred platform fee liability", type: "Liability" },
  { code: "4000", name: "Platform service fee revenue", type: "Revenue" },
];

export const normalBalance = (type: AccountType): NormalBalance => (type === "Asset" || type === "Expense" ? "Debit" : "Credit");
export const balanceOf = (normal: NormalBalance, debit: Decimal, credit: Decimal): Decimal => (normal === "Debit" ? debit.minus(credit) : credit.minus(debit));

export interface JournalLineInput {
  accountId: string; debitAmount: Decimal; creditAmount: Decimal; currency: string;
  groupId: string | null; cycleId: string | null; membershipId: string | null; selectionResultId: string | null; auctionResultId: string | null;
  referenceType: string; referenceId: string; description: string; paymentId?: string | null; contributionId?: string | null;
}

export interface JournalEntry {
  id: string; journalNumber: string; eventType: AccountingEventType; eventId: string; description: string; businessDate: DateOnly; businessTimeZone: string;
  postedAt: Date; postedBy: string; status: "POSTED"; correlationId: string | null; idempotencyKey: string; sourceModule: string; sourceFingerprint: string;
  policyVersion: "DHANVI_LEDGER_V1"; feePolicy: FeeRecognitionPolicy; createdAt: Date; reversesJournalEntryId: string | null; reversalReason: string | null;
  lineCount: number; debitTotal: Decimal; creditTotal: Decimal; lines: Array<JournalLineInput & { id: string; createdAt: Date }>;
}

/** JournalEntry.Post — validates identity, reversal linkage, every line, and debit/credit equality. */
export function postJournal(args: {
  id: string; number: string; eventType: AccountingEventType; eventId: string; sourceModule: string; fingerprint: string; description: string; timeZone: string;
  occurredAt: Date; postedAt: Date; actor: string; correlationId: string | null; feePolicy: FeeRecognitionPolicy; lines: JournalLineInput[];
  reverses?: string | null; reason?: string | null; newLineId: () => string;
}): JournalEntry {
  const a = args;
  requireRule(!!a.eventId && !!a.actor && !!a.number && a.number.length <= 40 && !!a.sourceModule && a.sourceModule.length <= 80 && !!a.description.trim() && a.description.length <= 1000 &&
    a.fingerprint.length === 64 && (a.correlationId?.length ?? 0) <= 100, "INVALID_JOURNAL", "Journal identity, actor, source and description are required.");
  const reverses = a.reverses ?? null;
  requireRule((reverses !== null) === (a.eventType === "AccountingReversal") && (reverses === null || (!!a.reason?.trim() && a.reason.length <= 1000)),
    "INVALID_REVERSAL", "A reversal requires its original journal and a reason.");
  const lines = a.lines.map((input) => {
    requireRule(!!input.accountId && !!input.referenceId && !!input.referenceType.trim() && input.referenceType.length <= 80 && input.description.length <= 500,
      "INVALID_JOURNAL_REFERENCE", "Valid account and structured source references are required.");
    requireRule(input.currency === "INR", "UNSUPPORTED_LEDGER_CURRENCY", "Only INR is supported by this policy.");
    requireRule(input.debitAmount.gte(0) && input.creditAmount.gte(0) && input.debitAmount.gt(0) !== input.creditAmount.gt(0) &&
      input.debitAmount.lte(MAX_AMOUNT) && input.creditAmount.lte(MAX_AMOUNT) && isPaise(input.debitAmount) && isPaise(input.creditAmount),
      "INVALID_JOURNAL_AMOUNT", "Each INR line needs exactly one positive side, exact to paise.");
    return { ...input, id: a.newLineId(), createdAt: a.postedAt };
  });
  const debitTotal = sum(lines.map((l) => l.debitAmount));
  const creditTotal = sum(lines.map((l) => l.creditAmount));
  requireRule(lines.length >= 2 && debitTotal.eq(creditTotal), "UNBALANCED_JOURNAL", "A journal must have at least two lines and equal total debits and credits.");
  return {
    id: a.id, journalNumber: a.number, eventType: a.eventType, eventId: a.eventId, description: a.description, businessDate: businessToday(a.occurredAt, a.timeZone),
    businessTimeZone: a.timeZone, postedAt: a.postedAt, postedBy: a.actor, status: "POSTED", correlationId: a.correlationId, idempotencyKey: `${a.eventType}:${a.eventId.replace(/-/g, "")}`,
    sourceModule: a.sourceModule, sourceFingerprint: a.fingerprint, policyVersion: "DHANVI_LEDGER_V1", feePolicy: a.feePolicy, createdAt: a.postedAt,
    reversesJournalEntryId: reverses, reversalReason: a.reason ?? null, lineCount: lines.length, debitTotal, creditTotal, lines,
  };
}

export interface BenefitSource { membershipId: string; amount: Decimal }

/** LedgerSource: built only from persisted, finalized business records by the source readers. */
export interface LedgerSource {
  eventType: AccountingEventType; eventId: string; sourceModule: string; groupId: string; cycleId: string; winnerMembershipId: string | null;
  selectionResultId: string | null; auctionResultId: string | null; groupValue: Decimal; winnerPayout: Decimal; platformFee: Decimal;
  benefits: BenefitSource[]; timeZone: string; occurredAt: Date; fingerprint: string;
}

export interface PostingLine { accountCode: string; debit: Decimal; credit: Decimal; membershipId: string | null }

/** LedgerPostingRules.Plan — manual contributions never post; selections post only once the group/cycle pool is funded. */
export function planPosting(source: LedgerSource, fundedPool: Decimal, feePolicy: FeeRecognitionPolicy): { deferredReason: string | null; lines: PostingLine[] } {
  if (source.eventType === "ContributionRecorded" || source.eventType === "ContributionReversed") return { deferredReason: "MANUAL_CONTRIBUTION_IS_NOT_PAYMENT", lines: [] };
  requireRule(["RandomSelectionCompleted", "OrganizerReservedSelectionCompleted", "AuctionSelectionCompleted"].includes(source.eventType),
    "UNSUPPORTED_ACCOUNTING_EVENT", "No posting rule exists for this event.");
  const benefitTotal = sum(source.benefits.map((b) => b.amount));
  requireRule(source.groupValue.gt(0) && source.winnerPayout.gt(0) && source.winnerMembershipId !== null && source.selectionResultId !== null &&
    source.winnerPayout.plus(source.platformFee).plus(benefitTotal).eq(source.groupValue) && source.platformFee.gte(0) &&
    source.benefits.every((b) => b.amount.gt(0) && b.membershipId !== source.winnerMembershipId) && new Set(source.benefits.map((b) => b.membershipId)).size === source.benefits.length,
    "INVALID_ACCOUNTING_SOURCE", "Finalized source allocations must conserve the group value.");
  // This balance comes exclusively from posted journals scoped to this group AND cycle.
  if (fundedPool.lt(source.groupValue)) return { deferredReason: "FUNDED_POOL_REQUIRED", lines: [] };
  const zero = new Decimal(0);
  const lines: PostingLine[] = [
    { accountCode: Accounts.GroupPool, debit: source.groupValue, credit: zero, membershipId: null },
    { accountCode: Accounts.MemberPayout, debit: zero, credit: source.winnerPayout, membershipId: source.winnerMembershipId },
    ...source.benefits.map((b) => ({ accountCode: Accounts.MemberBenefit, debit: zero, credit: b.amount, membershipId: b.membershipId })),
  ];
  if (source.platformFee.gt(0)) lines.push({ accountCode: feePolicy === "Deferred" ? Accounts.DeferredPlatformFee : Accounts.ServiceFeeRevenue, debit: zero, credit: source.platformFee, membershipId: null });
  return { deferredReason: null, lines };
}
