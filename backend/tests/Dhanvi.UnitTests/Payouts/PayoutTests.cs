using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.UnitTests.Payouts;
public sealed class PayoutTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 14, 0, 0, 0, TimeSpan.Zero);
    private static PayoutObligation Payout(decimal amount = 50000) => PayoutObligation.Create(Guid.NewGuid(), "Group", Guid.NewGuid(), 1, Guid.NewGuid(), Guid.NewGuid(), "Member",
        Guid.NewGuid(), null, Guid.NewGuid(), PayoutType.WinnerPayout, amount, "Asia/Kolkata", Guid.NewGuid(), Now);
    private static PayoutBeneficiary Beneficiary(PayoutObligation p, bool changed = false) => PayoutBeneficiary.Create(p.UserId!.Value, "fake_fa_test", "Member", "1234", "TEST0123456", "Test bank", Now, changed);
    [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(1.001)]
    public void PayoutRejectsInvalidCurrencyPrecision(decimal amount) => Assert.Throws<BusinessRuleException>(() => Payout(amount));
    [Theory] [InlineData(0.01)] [InlineData(50000)]
    public void PayoutPreservesExactAmount(decimal amount) => Assert.Equal(amount, Payout(amount).Amount);
    [Fact] public void LargePayoutRemainsExact() => Assert.Equal(9999999999999999.99m, Payout(9999999999999999.99m).Amount);
    [Fact] public void SelectionCreatesUnsettledRight() { var p = Payout(); Assert.Equal(PayoutStatus.PendingBeneficiary, p.Status); Assert.Null(p.SettledAt); Assert.Null(p.BeneficiaryId); }
    [Theory] [InlineData("123", "123", "TEST0123456")] [InlineData("123456789", "123456780", "TEST0123456")] [InlineData("123456789", "123456789", "TEST1123456")]
    public void BeneficiaryValidatesFormatAndConfirmation(string account, string confirmation, string ifsc) => Assert.Throws<BusinessRuleException>(() => PayoutBeneficiary.Validate("Test", account, confirmation, ifsc, "Bank"));
    [Fact] public void BeneficiaryStoresOnlyMaskAndFakeReference() { var p = Payout(); var b = Beneficiary(p); Assert.Equal("****1234", b.MaskedAccountNumber); Assert.Equal(BeneficiaryStatus.FormatValidated, b.Status); Assert.DoesNotContain(typeof(BeneficiaryView).GetProperties(), x => x.Name == "AccountNumber"); }
    [Fact] public void ApprovalLocksDestination() { var p = Payout(); var b = Beneficiary(p); p.Approve(b, Guid.NewGuid(), Now); Assert.Equal(b.Id, p.BeneficiaryId); Assert.Throws<BusinessRuleException>(() => p.Approve(Beneficiary(p), Guid.NewGuid(), Now)); }
    [Fact] public void RecipientCannotApproveSelf() { var p = Payout(); Assert.Throws<BusinessRuleException>(() => p.Approve(Beneficiary(p), p.UserId!.Value, Now)); }
    [Fact] public void WrongUserBeneficiaryCannotBeApproved() { var p = Payout(); Assert.Throws<BusinessRuleException>(() => p.Approve(Beneficiary(Payout()), Guid.NewGuid(), Now)); }
    [Fact] public void ChangedAccountHoldIsEnforced() { var p = Payout(); var b = Beneficiary(p, true); Assert.Throws<BusinessRuleException>(() => p.Approve(b, Guid.NewGuid(), Now)); p.Approve(b, Guid.NewGuid(), Now.AddDays(1)); Assert.Equal(PayoutStatus.Approved, p.Status); }
    [Fact] public void UnapprovedPayoutCannotExecute() => Assert.Throws<BusinessRuleException>(() => Payout().Begin(false, Now));
    [Fact] public void FailureRetainsAmountAndRetryAppendsIntent()
    {
        var p = Payout(); var b = Beneficiary(p); var actor = Guid.NewGuid(); p.Approve(b, actor, Now); p.Begin(false, Now);
        var first = PayoutAttempt.Create(p, b, 1, "first", actor, Now); p.Observe(PayoutStatus.Failed, Now); Assert.Null(p.SettlementJournalId); Assert.Equal(50000, p.Amount);
        p.Begin(true, Now); var second = PayoutAttempt.Create(p, b, 2, "retry", actor, Now); Assert.NotEqual(first.IdempotencyKey, second.IdempotencyKey); Assert.Equal(1, first.AttemptNumber); Assert.Equal(first.ProviderFundAccountId, second.ProviderFundAccountId);
    }
    [Fact] public void PendingCannotRetry() { var p = Payout(); p.Approve(Beneficiary(p), Guid.NewGuid(), Now); p.Begin(false, Now); p.Observe(PayoutStatus.ProviderPending, Now); Assert.Throws<BusinessRuleException>(() => p.Begin(true, Now)); }
    [Fact] public void ReconciliationHoldIsSticky() { var p = Payout(); p.Approve(Beneficiary(p), Guid.NewGuid(), Now); p.Begin(false, Now); p.Observe(PayoutStatus.ReconciliationRequired, Now); p.Observe(PayoutStatus.ProviderPending, Now); Assert.Equal(PayoutStatus.ReconciliationRequired, p.Status); Assert.Throws<BusinessRuleException>(() => p.Settle(Guid.NewGuid(), Now)); }
    [Fact] public void SuccessCannotRegress() { var p = Payout(); p.Approve(Beneficiary(p), Guid.NewGuid(), Now); p.Begin(false, Now); p.Settle(Guid.NewGuid(), Now); p.Observe(PayoutStatus.ProviderPending, Now); Assert.Equal(PayoutStatus.Succeeded, p.Status); Assert.Throws<BusinessRuleException>(() => p.Begin(true, Now)); }
    [Fact] public void MemberAndOrganizerCannotOperate() { var policy = new AdminPayoutApprovalPolicy(); Assert.Throws<ForbiddenException>(() => policy.EnsureOperator(false, Guid.NewGuid(), null)); policy.EnsureOperator(true, Guid.NewGuid(), null); }
    [Fact] public void ExternalPayoutCannotUseInternalFeeSettlement() => Assert.Throws<BusinessRuleException>(() => Payout().SettleInternalFee(Now));
}
