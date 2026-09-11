using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Ledger.Application;

public sealed record PostingLine(string AccountCode, decimal Debit, decimal Credit, Guid? MembershipId);
public sealed record PostingPlan(string? DeferredReason, IReadOnlyList<PostingLine> Lines);
public static class LedgerPostingRules
{
    public const string Version = "DHANVI_LEDGER_V1";
    public static PostingPlan Plan(LedgerSource source, decimal fundedPool, FeeRecognitionPolicy feePolicy)
    {
        BusinessRuleException.Require(Enum.IsDefined(feePolicy), "INVALID_LEDGER_POLICY", "Unsupported fee recognition policy.");
        if (source.EventType is AccountingEventType.ContributionRecorded or AccountingEventType.ContributionReversed)
            return new("MANUAL_CONTRIBUTION_IS_NOT_PAYMENT", []);
        BusinessRuleException.Require(source.EventType is AccountingEventType.RandomSelectionCompleted or AccountingEventType.OrganizerReservedSelectionCompleted or AccountingEventType.AuctionSelectionCompleted,
            "UNSUPPORTED_ACCOUNTING_EVENT", "No posting rule exists for this event.");
        BusinessRuleException.Require(source.GroupValue > 0 && source.WinnerPayout > 0 && source.WinnerMembershipId.HasValue && source.SelectionResultId.HasValue &&
            source.WinnerPayout + source.PlatformFee + source.Benefits.Sum(b => b.Amount) == source.GroupValue && source.PlatformFee >= 0 &&
            source.Benefits.All(b => b.Amount > 0 && b.MembershipId != source.WinnerMembershipId) && source.Benefits.Select(b => b.MembershipId).Distinct().Count() == source.Benefits.Count,
            "INVALID_ACCOUNTING_SOURCE", "Finalized source allocations must conserve the group value.");
        // This balance comes exclusively from posted journals scoped to this group AND cycle.
        if (fundedPool < source.GroupValue) return new("FUNDED_POOL_REQUIRED", []);
        var lines = new List<PostingLine> { new(ChartOfAccounts.GroupPool, source.GroupValue, 0, null), new(ChartOfAccounts.MemberPayout, 0, source.WinnerPayout, source.WinnerMembershipId) };
        lines.AddRange(source.Benefits.Select(b => new PostingLine(ChartOfAccounts.MemberBenefit, 0, b.Amount, b.MembershipId)));
        if (source.PlatformFee > 0) lines.Add(new(feePolicy == FeeRecognitionPolicy.Deferred ? ChartOfAccounts.DeferredPlatformFee : ChartOfAccounts.ServiceFeeRevenue, 0, source.PlatformFee, null));
        return new(null, lines);
    }
}
