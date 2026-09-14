using System.Security.Cryptography;
using System.Text;
using Dhanvi.Modules.Payments.Domain;
using Dhanvi.Modules.Payments.Infrastructure;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.UnitTests.Payments;

public sealed class PaymentTests
{
    private static Payment New() => Payment.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Group", "Member", 1, "Asia/Kolkata", 2500, "test", 1, DateTimeOffset.UtcNow);
    [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(1.001)]
    public void MoneyRejectsInvalidAmounts(decimal amount) => Assert.Throws<BusinessRuleException>(() => PaymentMoney.ToMinorUnits(amount));
    [Theory] [InlineData(0.01, 1)] [InlineData(2500, 250000)]
    public void MoneyConvertsExactly(decimal amount, long minor) { Assert.Equal(minor, PaymentMoney.ToMinorUnits(amount)); Assert.Equal(amount, PaymentMoney.FromMinorUnits(minor)); }
    [Fact] public void FailedAttemptCanBeFollowedByCaptureButCaptureCannotRegress()
    {
        var p = New(); var now = DateTimeOffset.UtcNow; p.SetOrder("order_test", now);
        Assert.True(p.Observe("pay_failed", PaymentStatus.Failed, now, now)); Assert.Null(p.ProviderPaymentId);
        Assert.True(p.Observe("pay_success", PaymentStatus.Captured, now, now)); p.Settle(Guid.NewGuid(), now);
        Assert.False(p.Observe("pay_failed", PaymentStatus.Failed, now, now)); Assert.False(p.Observe("pay_success", PaymentStatus.Authorized, now, now)); Assert.Equal(PaymentStatus.Captured, p.Status);
        Assert.Throws<BusinessRuleException>(() => p.Settle(Guid.NewGuid(), now));
    }
    [Fact] public void RefundKeepsOriginalSettlementAndCannotCaptureAgain()
    {
        var p = New(); var now = DateTimeOffset.UtcNow; var journal = Guid.NewGuid(); p.SetOrder("order_test", now);
        p.Observe("pay_test", PaymentStatus.Captured, now, now); p.Settle(journal, now); p.RefundPending(now); p.Refund(Guid.NewGuid(), now);
        Assert.Equal(journal, p.JournalId); Assert.NotNull(p.SettledAt); Assert.NotNull(p.ReversalJournalId);
        Assert.False(p.Observe("pay_test", PaymentStatus.Captured, now, now)); Assert.Equal(PaymentStatus.Refunded, p.Status);
    }
    [Theory] [InlineData("")] [InlineData("bad")] [InlineData("gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg")]
    public void MalformedSignaturesAreRejected(string signature) => Assert.False(RazorpaySignatures.Verify(Encoding.UTF8.GetBytes("body"), signature, "test-only"));
    [Fact] public void SignatureUsesExactBytesAndConstantTimeComparison()
    {
        var bytes = Encoding.UTF8.GetBytes("{\"a\":1}"); const string secret = "test-only";
        var signature = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), bytes));
        Assert.True(RazorpaySignatures.Verify(bytes, signature, secret));
        Assert.False(RazorpaySignatures.Verify(Encoding.UTF8.GetBytes("{ \"a\":1}"), signature, secret));
        Assert.False(RazorpaySignatures.Verify(bytes, signature, "different"));
    }
    [Theory] [InlineData("LIVE", "rzp_live_x")] [InlineData("TEST", "rzp_live_x")]
    public void LiveConfigurationIsRejected(string environment, string key) => Assert.False(new RazorpayOptions { Environment = environment, KeyId = key }.Valid());
}
