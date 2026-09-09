using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;

namespace Dhanvi.UnitTests.Auctions;

public sealed class AuctionTests
{
    private static readonly DateTimeOffset Start = new(2030, 1, 2, 10, 0, 0, TimeSpan.Zero);
    private static Auction Scheduled() => Auction.Schedule(Guid.NewGuid(), Guid.NewGuid(), 1, 500000, 20,
        new(50000, 200000, 5000, new(10, 0), new(11, 0)), Start, Start.AddHours(1), Start.AddDays(-1));
    private static Auction Open() { var auction = Scheduled(); auction.Open(Start); return auction; }

    [Fact]
    public void V1ExampleConservesDiscountWithoutCollectingAnAdditionalFee()
    {
        var result = AuctionCalculator.Calculate(500000, 20, 150000, AuctionFeePolicy.WinnerMemberShare);
        Assert.Equal("DHANVI_AUCTION_V1", AuctionCalculator.Version);
        Assert.Equal(350000, result.WinnerPayout);
        Assert.Equal(7500, result.GrossMemberShare);
        Assert.Equal(7500, result.PlatformFee);
        Assert.Equal(142500, result.MemberBenefitPool);
        Assert.Equal(19, result.NonWinnerCount);
        Assert.Equal(7500, result.BenefitPerNonWinner);
        Assert.Equal(150000, result.MemberBenefitPool + result.PlatformFee);
    }

    [Fact]
    public void EverySupportedMemberCountHasExactAllocations()
    {
        for (var members = 20; members <= 50; members++)
        {
            var result = AuctionCalculator.Calculate(members * 25000m, members, members * 7500m, AuctionFeePolicy.WinnerMemberShare);
            Assert.Equal(members * 7500m, result.MemberBenefitPool + result.PlatformFee);
            Assert.Equal(result.MemberBenefitPool, result.BenefitPerNonWinner * (members - 1));
        }
    }

    [Theory]
    [InlineData("-1", "INVALID_DISCOUNT")]
    [InlineData("0", "INVALID_DISCOUNT")]
    [InlineData("500000", "INVALID_DISCOUNT")]
    [InlineData("500001", "INVALID_DISCOUNT")]
    [InlineData("150000.001", "INVALID_DISCOUNT")]
    [InlineData("150000.01", "INVALID_AUCTION_ALLOCATION_PRECISION")]
    public void InvalidMoneyIsRejectedInsteadOfRounded(string input, string code)
    {
        var amount = decimal.Parse(input, System.Globalization.CultureInfo.InvariantCulture);
        var error = Assert.Throws<BusinessRuleException>(() => AuctionCalculator.Calculate(500000, 20, amount, AuctionFeePolicy.WinnerMemberShare));
        Assert.Equal(code, error.Code);
    }

    [Fact]
    public void ExactPaiseSharesAreAllowed()
    {
        var result = AuctionCalculator.Calculate(500000, 20, 150000.20m, AuctionFeePolicy.WinnerMemberShare);
        Assert.Equal(7500.01m, result.GrossMemberShare);
        Assert.Equal(349999.80m, result.WinnerPayout);
    }

    [Fact]
    public void UnsupportedFeePolicyIsRejected() =>
        Assert.Throws<BusinessRuleException>(() => AuctionCalculator.Calculate(500000, 20, 150000, (AuctionFeePolicy)99));

    [Theory]
    [InlineData(-1)]
    [InlineData(3600)]
    public void OpeningOutsideWindowFails(int seconds)
    {
        var auction = Scheduled();
        Assert.Throws<BusinessRuleException>(() => auction.Open(Start.AddSeconds(seconds)));
        Assert.Equal(AuctionStatus.Scheduled, auction.Status);
    }

    [Fact]
    public void LifecycleAndSameMemberIncreasesPreserveHistory()
    {
        var auction = Open(); var member = Guid.NewGuid();
        var first = auction.Bid(member, 50000, "first", Start);
        var second = auction.Bid(member, 55000, "second", Start.AddSeconds(1));
        Assert.Equal(50000, first.DiscountAmount);
        Assert.Equal(1, first.SequenceNumber);
        Assert.Equal(2, second.SequenceNumber);
        Assert.Equal(second.Id, auction.CurrentWinningBidId);
        auction.Close(Auction.WinningBid([first, second]), Start.AddHours(1));
        Assert.Equal(AuctionStatus.WinnerSelected, auction.Status);
        Assert.Throws<BusinessRuleException>(() => auction.Bid(member, 60000, "late", Start.AddSeconds(2)));
        Assert.Throws<BusinessRuleException>(() => auction.Open(Start));
        Assert.Throws<BusinessRuleException>(() => auction.Close(second, Start));
    }

    [Theory]
    [InlineData(49999, "DISCOUNT_BELOW_MINIMUM")]
    [InlineData(205000, "DISCOUNT_ABOVE_MAXIMUM")]
    public void ConfiguredBoundsAreEnforced(int discount, string code)
    {
        // Use exact allocation amounts so the intended bound is the failing rule.
        var value = discount == 49999 ? 49999.80m : discount;
        Assert.Equal(code, Assert.Throws<BusinessRuleException>(() => Open().Bid(Guid.NewGuid(), value, "key", Start)).Code);
    }

    [Fact]
    public void IncrementIsRelativeToAuthoritativeHighest()
    {
        var auction = Open(); auction.Bid(Guid.NewGuid(), 50000, "a", Start);
        Assert.Equal("BID_INCREMENT_NOT_MET", Assert.Throws<BusinessRuleException>(() => auction.Bid(Guid.NewGuid(), 54999.80m, "b", Start)).Code);
        Assert.Equal(1, auction.LastBidSequence);
        Assert.Equal(200000, auction.Bid(Guid.NewGuid(), 200000, "c", Start).DiscountAmount);
    }

    [Fact]
    public void EndOfWindowRejectsBidsEvenBeforeManualClose() =>
        Assert.Equal("AUCTION_OUTSIDE_WINDOW", Assert.Throws<BusinessRuleException>(() => Open().Bid(Guid.NewGuid(), 50000, "key", Start.AddHours(1))).Code);

    [Fact]
    public void HighestDiscountThenServerSequenceWinsRegardlessOfTimestamps()
    {
        var auction = Open(); var member = Guid.NewGuid();
        var first = new AuctionBid(auction.Id, auction.GroupId, auction.CycleId, member, 100000, 1, "a", Start.AddSeconds(10));
        var tie = new AuctionBid(auction.Id, auction.GroupId, auction.CycleId, member, 100000, 2, "b", Start);
        var lower = new AuctionBid(auction.Id, auction.GroupId, auction.CycleId, member, 50000, 3, "c", Start);
        Assert.Same(first, Auction.WinningBid([tie, lower, first]));
        Assert.Null(Auction.WinningBid([]));
    }

    [Fact]
    public void EmptyCloseIsUnresolved()
    {
        var auction = Open(); auction.Close(null, Start);
        Assert.Equal(AuctionStatus.ClosedNoBids, auction.Status);
        Assert.Null(auction.WinnerSelectedAt);
        Assert.Null(auction.CurrentWinningBidId);
    }

    [Fact]
    public void InconsistentCloseDoesNotMutateTheAuction()
    {
        var auction = Open(); auction.Bid(Guid.NewGuid(), 50000, "key", Start);
        Assert.Throws<BusinessRuleException>(() => auction.Close(null, Start));
        Assert.Equal(AuctionStatus.Open, auction.Status);
        Assert.Null(auction.ClosedAt);
    }

    [Fact]
    public void BenefitAllocationsIncludeEveryOtherPositionAndOneProposedFee()
    {
        var auction = Open(); var members = Enumerable.Range(0, 20).Select(_ => Guid.NewGuid()).ToArray();
        var bid = auction.Bid(members[0], 150000, "key", Start);
        var result = AuctionResult.Create(auction, bid, Guid.NewGuid(), members, Guid.NewGuid(), Start);
        Assert.Equal(20, result.Allocations.Count);
        Assert.Equal(19, result.Allocations.Count(a => a.AllocationType == AuctionAllocationType.MemberBenefit));
        Assert.DoesNotContain(result.Allocations, a => a.MembershipId == members[0]);
        Assert.Single(result.Allocations, a => a.AllocationType == AuctionAllocationType.PlatformFee && a.MembershipId is null);
        Assert.All(result.Allocations, a => Assert.Equal(7500, a.Amount));
        Assert.Equal(result.WinningDiscount, result.Allocations.Sum(a => a.Amount));
        Assert.Equal("DHANVI_AUCTION_V1", result.CalculationVersion);
        Assert.Throws<BusinessRuleException>(() => AuctionResult.Create(auction, bid, Guid.NewGuid(), members.Skip(1).ToArray(), Guid.NewGuid(), Start));
    }

    [Fact]
    public void ServerBidTimestampUsesPostgreSqlMicrosecondPrecision()
    {
        var bid = Open().Bid(Guid.NewGuid(), 50000, "key", Start.AddTicks(17));
        Assert.Equal(Start.AddTicks(10), bid.SubmittedAt);
        Assert.Equal(TimeSpan.Zero, bid.SubmittedAt.Offset);
    }
}
