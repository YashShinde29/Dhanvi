using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Auctions.Domain;

public enum AuctionStatus { Scheduled, Open, Closed, WinnerSelected, ClosedNoBids }
public sealed class Auction
{
    private Auction() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public int CycleNumber { get; private set; }
    public AuctionStatus Status { get; private set; }
    public DateTimeOffset StartsAt { get; private set; }
    public DateTimeOffset EndsAt { get; private set; }
    public decimal GroupValue { get; private set; }
    public int MemberLimit { get; private set; }
    public decimal MinimumDiscount { get; private set; }
    public decimal MaximumDiscount { get; private set; }
    public decimal BidIncrement { get; private set; }
    public AuctionFeePolicy FeePolicy { get; private set; }
    public decimal CurrentHighestDiscount { get; private set; }
    public Guid? CurrentWinningBidId { get; private set; }
    public Guid? CurrentWinningMembershipId { get; private set; }
    public long LastBidSequence { get; private set; }
    public DateTimeOffset? OpenedAt { get; private set; }
    public DateTimeOffset? ClosedAt { get; private set; }
    public DateTimeOffset? WinnerSelectedAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public int Version { get; private set; }
    public static Auction Schedule(Guid groupId, Guid cycleId, int number, decimal value, int members, AuctionGroupRules rules, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now)
    {
        BusinessRuleException.Require(start < end && rules.MinimumDiscount >= 0 && rules.MinimumDiscount <= rules.MaximumDiscount && rules.BidIncrement > 0 && rules.BidIncrement < value,
            "INVALID_AUCTION_RULES", "Auction limits, increment and window must be valid.");
        AuctionCalculator.Calculate(value, members, rules.MaximumDiscount, rules.FeePolicy);
        BusinessRuleException.Require(rules.MinimumDiscount * 100 % members == 0 && rules.BidIncrement * 100 % members == 0,
            "INVALID_AUCTION_ALLOCATION_PRECISION", "Configured limits and increment must support exact member shares.");
        return new() { GroupId = groupId, CycleId = cycleId, CycleNumber = number, GroupValue = value, MemberLimit = members,
            MinimumDiscount = rules.MinimumDiscount, MaximumDiscount = rules.MaximumDiscount, BidIncrement = rules.BidIncrement, FeePolicy = rules.FeePolicy,
            StartsAt = start, EndsAt = end, CreatedAt = now, UpdatedAt = now, Status = AuctionStatus.Scheduled };
    }
    public void Open(DateTimeOffset now)
    {
        BusinessRuleException.Require(Status == AuctionStatus.Scheduled, "AUCTION_ALREADY_EXISTS", "This auction has already been opened or closed.");
        BusinessRuleException.Require(now >= StartsAt && now < EndsAt, "AUCTION_OUTSIDE_WINDOW", "Open the auction within its configured time window.");
        Status = AuctionStatus.Open; OpenedAt = now; Touch(now);
    }
    public AuctionBid Bid(Guid membershipId, decimal discount, string key, DateTimeOffset now)
    {
        EnsureOpen();
        BusinessRuleException.Require(now >= OpenedAt && now >= StartsAt && now < EndsAt, "AUCTION_OUTSIDE_WINDOW", "Bidding is outside the server-authoritative auction window.");
        AuctionCalculator.Calculate(GroupValue, MemberLimit, discount, FeePolicy);
        BusinessRuleException.Require(discount >= MinimumDiscount, "DISCOUNT_BELOW_MINIMUM", "Discount is below the configured minimum.");
        BusinessRuleException.Require(discount <= MaximumDiscount, "DISCOUNT_ABOVE_MAXIMUM", "Discount exceeds the configured maximum.");
        BusinessRuleException.Require(LastBidSequence == 0 || discount >= CurrentHighestDiscount + BidIncrement, "BID_INCREMENT_NOT_MET", "Increase the current highest discount by at least the configured increment.");
        var bid = new AuctionBid(Id, GroupId, CycleId, membershipId, discount, checked(LastBidSequence + 1), key, now);
        LastBidSequence = bid.SequenceNumber; CurrentHighestDiscount = discount; CurrentWinningBidId = bid.Id; CurrentWinningMembershipId = membershipId; Touch(now); return bid;
    }
    public static AuctionBid? WinningBid(IEnumerable<AuctionBid> bids) => bids.OrderByDescending(b => b.DiscountAmount).ThenBy(b => b.SequenceNumber).FirstOrDefault();
    public void Close(AuctionBid? winner, DateTimeOffset now)
    {
        EnsureOpen(); ClosedAt = now; Status = AuctionStatus.Closed;
        BusinessRuleException.Require(winner is null ? LastBidSequence == 0 : winner.AuctionId == Id && winner.Id == CurrentWinningBidId && winner.DiscountAmount == CurrentHighestDiscount,
            "AUCTION_HISTORY_INCONSISTENT", "The authoritative bid history and current auction state do not agree.");
        if (winner is null) Status = AuctionStatus.ClosedNoBids;
        else { Status = AuctionStatus.WinnerSelected; WinnerSelectedAt = now; }
        Touch(now);
    }
    public void EnsureOpen() => BusinessRuleException.Require(Status == AuctionStatus.Open,
        Status is AuctionStatus.Closed or AuctionStatus.ClosedNoBids or AuctionStatus.WinnerSelected ? "AUCTION_CLOSED" : "AUCTION_NOT_OPEN", "Auction is not open for bidding.");
    private void Touch(DateTimeOffset now) { UpdatedAt = now; Version++; }
}
public sealed class AuctionBid(Guid auctionId, Guid groupId, Guid cycleId, Guid membershipId, decimal discountAmount, long sequenceNumber, string idempotencyKey, DateTimeOffset submittedAt)
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid AuctionId { get; private set; } = auctionId;
    public Guid GroupId { get; private set; } = groupId;
    public Guid CycleId { get; private set; } = cycleId;
    public Guid MembershipId { get; private set; } = membershipId;
    public decimal DiscountAmount { get; private set; } = discountAmount;
    public long SequenceNumber { get; private set; } = sequenceNumber;
    public string IdempotencyKey { get; private set; } = idempotencyKey;
    public DateTimeOffset SubmittedAt { get; private set; } = submittedAt;
}
