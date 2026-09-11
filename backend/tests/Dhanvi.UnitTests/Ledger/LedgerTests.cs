using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.UnitTests.Ledger;

public sealed class LedgerTests
{
    private static readonly DateTimeOffset Now = new(2030, 1, 2, 20, 0, 0, TimeSpan.Zero);
    private static JournalLineInput Line(decimal debit, decimal credit, string currency = "INR") => new(Guid.NewGuid(), debit, credit, currency, null, null, null, null, null, "TestSource", Guid.NewGuid(), "Test line");
    private static JournalEntry Post(params JournalLineInput[] lines) => JournalEntry.Post("JRN-000001", AccountingEventType.RandomSelectionCompleted, Guid.NewGuid(), "RandomDraws", new('a', 64),
        "Test journal", "Asia/Kolkata", Now, Now.ToOffset(TimeSpan.FromHours(5.5)), Guid.NewGuid(), "test-correlation", FeeRecognitionPolicy.Deferred, lines);
    [Fact] public void BalancedJournalPreservesSourceAndUsesUtcAndBusinessDate()
    {
        var journal = Post(Line(100, 0), Line(0, 100)); Assert.Equal(100, journal.DebitTotal); Assert.Equal(journal.DebitTotal, journal.CreditTotal);
        Assert.Equal(new DateOnly(2030, 1, 3), journal.BusinessDate); Assert.Equal(TimeSpan.Zero, journal.PostedAt.Offset);
        Assert.Equal("POSTED", journal.Status); Assert.Equal("DHANVI_LEDGER_V1", journal.PolicyVersion); Assert.Equal("test-correlation", journal.CorrelationId);
        Assert.All(journal.Lines, l => Assert.Equal("TestSource", l.ReferenceType));
    }
    [Theory] [InlineData(100, 99)] [InlineData(100, 101)]
    public void UnbalancedJournalRejected(int debit, int credit) => Assert.Throws<BusinessRuleException>(() => Post(Line(debit, 0), Line(0, credit)));
    [Theory] [InlineData("1", "1")] [InlineData("0", "0")] [InlineData("-1", "0")] [InlineData("0", "-1")] [InlineData("0.001", "0")]
    public void InvalidLineAmountsRejected(string debit, string credit) => Assert.Throws<BusinessRuleException>(() => Post(Line(decimal.Parse(debit, System.Globalization.CultureInfo.InvariantCulture), decimal.Parse(credit, System.Globalization.CultureInfo.InvariantCulture)), Line(0, 1)));
    [Fact] public void UnsupportedCurrencyRejected() => Assert.Throws<BusinessRuleException>(() => Post(Line(10, 0, "USD"), Line(0, 10, "USD")));
    [Fact] public void EmptyJournalRejected() => Assert.Throws<BusinessRuleException>(() => Post());
    [Theory] [InlineData(AccountType.Asset, NormalBalance.Debit, 60)] [InlineData(AccountType.Expense, NormalBalance.Debit, 60)]
    [InlineData(AccountType.Liability, NormalBalance.Credit, -60)] [InlineData(AccountType.Revenue, NormalBalance.Credit, -60)] [InlineData(AccountType.Equity, NormalBalance.Credit, -60)]
    public void NormalBalancesPresentCorrectly(AccountType type, NormalBalance normal, int amount)
    { Assert.Equal(normal, ChartOfAccounts.Normal(type)); Assert.Equal(amount, ChartOfAccounts.Balance(normal, 100, 40)); }
    [Fact] public void ReversalSwapsAllLinesWithoutMutatingOriginal()
    {
        var debit = Line(100, 0); var credit = Line(0, 100); var original = Post(debit, credit); var reversed = original.ReversedLines();
        Assert.Equal(debit with { DebitAmount = 0, CreditAmount = 100 }, reversed[0]); Assert.Equal(credit with { DebitAmount = 100, CreditAmount = 0 }, reversed[1]);
        Assert.Equal(100, original.Lines.First().DebitAmount); Assert.Null(original.ReversesJournalEntryId);
    }
    private static LedgerSource Source(AccountingEventType type, decimal payout = 500000, decimal fee = 0, IReadOnlyList<BenefitSource>? benefits = null) =>
        new(type, Guid.NewGuid(), "Test", Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), null, 500000, payout, fee, benefits ?? [], "Asia/Kolkata", Now, new('a', 64));
    [Theory] [InlineData(AccountingEventType.ContributionRecorded)] [InlineData(AccountingEventType.ContributionReversed)]
    public void ManualContributionsNeverCreateCashOrOtherFinancialPosting(AccountingEventType type)
    { var plan = LedgerPostingRules.Plan(Source(type), 500000, FeeRecognitionPolicy.Deferred); Assert.Equal("MANUAL_CONTRIBUTION_IS_NOT_PAYMENT", plan.DeferredReason); Assert.Empty(plan.Lines); }
    [Theory] [InlineData(AccountingEventType.RandomSelectionCompleted)] [InlineData(AccountingEventType.OrganizerReservedSelectionCompleted)] [InlineData(AccountingEventType.AuctionSelectionCompleted)]
    public void UnfundedSelectionsAreDeferred(AccountingEventType type)
    { var plan = LedgerPostingRules.Plan(Source(type), 499999, FeeRecognitionPolicy.Deferred); Assert.Equal("FUNDED_POOL_REQUIRED", plan.DeferredReason); Assert.Empty(plan.Lines); }
    [Theory] [InlineData(AccountingEventType.RandomSelectionCompleted)] [InlineData(AccountingEventType.OrganizerReservedSelectionCompleted)]
    public void FundedSelectionTransfersLiabilityWithoutCash(AccountingEventType type)
    { var plan = LedgerPostingRules.Plan(Source(type), 500000, FeeRecognitionPolicy.Deferred); Assert.Null(plan.DeferredReason); Assert.Equal(500000, plan.Lines.Single(l => l.AccountCode == ChartOfAccounts.GroupPool).Debit); Assert.Equal(500000, plan.Lines.Single(l => l.AccountCode == ChartOfAccounts.MemberPayout).Credit); }
    [Theory] [InlineData(FeeRecognitionPolicy.Deferred, "2300")] [InlineData(FeeRecognitionPolicy.OnFundedSelection, "4000")]
    public void AuctionConsumesFinalCalculationAndExplicitFeePolicy(FeeRecognitionPolicy policy, string feeAccount)
    {
        var benefits = Enumerable.Range(0, 19).Select(_ => new BenefitSource(Guid.NewGuid(), 7500)).ToArray();
        var plan = LedgerPostingRules.Plan(Source(AccountingEventType.AuctionSelectionCompleted, 350000, 7500, benefits), 500000, policy);
        Assert.Null(plan.DeferredReason); Assert.Equal(7500, plan.Lines.Single(l => l.AccountCode == feeAccount).Credit);
        Assert.Equal(142500, plan.Lines.Where(l => l.AccountCode == ChartOfAccounts.MemberBenefit).Sum(l => l.Credit));
        Assert.Equal(plan.Lines.Sum(l => l.Debit), plan.Lines.Sum(l => l.Credit)); Assert.DoesNotContain(plan.Lines, l => l.AccountCode == ChartOfAccounts.CashClearing || l.AccountCode == ChartOfAccounts.PlatformFeeReceivable);
    }
    [Fact] public void NoPaymentHandlerExists() => Assert.Throws<BusinessRuleException>(() => LedgerPostingRules.Plan(Source(AccountingEventType.PaymentReceived), 500000, FeeRecognitionPolicy.Deferred));
    [Fact] public void InvalidSourceAllocationsRejected() => Assert.Throws<BusinessRuleException>(() => LedgerPostingRules.Plan(Source(AccountingEventType.AuctionSelectionCompleted, 350000, 7500), 500000, FeeRecognitionPolicy.Deferred));
    [Fact] public void AccountCodesAreStableAndUnique() => Assert.Equal(ChartOfAccounts.SystemAccounts.Count, ChartOfAccounts.SystemAccounts.Select(a => a.Code).Distinct().Count());
}
