using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Auctions.Domain;
public enum AuctionAllocationType { MemberBenefit, PlatformFee }
public sealed class AuctionResult
{
    private readonly List<AuctionBenefitAllocation> _allocations = [];
    private AuctionResult() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid AuctionId { get; private set; }
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public Guid SelectionResultId { get; private set; }
    public Guid WinningBidId { get; private set; }
    public Guid WinnerMembershipId { get; private set; }
    public decimal GroupValue { get; private set; }
    public int MemberLimit { get; private set; }
    public decimal WinningDiscount { get; private set; }
    public decimal WinnerPayout { get; private set; }
    public decimal GrossMemberShare { get; private set; }
    public decimal PlatformFee { get; private set; }
    public decimal MemberBenefitPool { get; private set; }
    public AuctionFeePolicy FeePolicy { get; private set; }
    public string CalculationVersion { get; private set; } = AuctionCalculator.Version;
    public DateTimeOffset FinalizedAt { get; private set; }
    public Guid FinalizedByUserId { get; private set; }
    public IReadOnlyCollection<AuctionBenefitAllocation> Allocations => _allocations.AsReadOnly();
    public static AuctionResult Create(Auction auction, AuctionBid winner, Guid selectionResultId, IReadOnlyList<Guid> memberIds, Guid actor, DateTimeOffset now)
    {
        BusinessRuleException.Require(winner.AuctionId == auction.Id && memberIds.Count == auction.MemberLimit && memberIds.Distinct().Count() == auction.MemberLimit && memberIds.Contains(winner.MembershipId),
            "INVALID_AUCTION_RECIPIENTS", "Every original member position, including prior payout recipients, must be represented.");
        var calculation = AuctionCalculator.Calculate(auction.GroupValue, auction.MemberLimit, winner.DiscountAmount, auction.FeePolicy);
        var result = new AuctionResult { AuctionId = auction.Id, GroupId = auction.GroupId, CycleId = auction.CycleId, SelectionResultId = selectionResultId,
            WinningBidId = winner.Id, WinnerMembershipId = winner.MembershipId, GroupValue = auction.GroupValue, MemberLimit = auction.MemberLimit, WinningDiscount = winner.DiscountAmount,
            WinnerPayout = calculation.WinnerPayout, GrossMemberShare = calculation.GrossMemberShare, PlatformFee = calculation.PlatformFee, MemberBenefitPool = calculation.MemberBenefitPool,
            FeePolicy = auction.FeePolicy, FinalizedAt = now, FinalizedByUserId = actor };
        foreach (var member in memberIds.Where(id => id != winner.MembershipId)) result._allocations.Add(new(result.Id, auction.GroupId, member, AuctionAllocationType.MemberBenefit, calculation.GrossMemberShare, now));
        result._allocations.Add(new(result.Id, auction.GroupId, null, AuctionAllocationType.PlatformFee, calculation.PlatformFee, now));
        BusinessRuleException.Require(result.Allocations.Sum(a => a.Amount) == winner.DiscountAmount, "INVALID_AUCTION_ALLOCATION_PRECISION", "Allocations must conserve the winning discount.");
        return result;
    }
}
public sealed class AuctionBenefitAllocation(Guid auctionResultId, Guid groupId, Guid? membershipId, AuctionAllocationType allocationType, decimal amount, DateTimeOffset createdAt)
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid AuctionResultId { get; private set; } = auctionResultId;
    public Guid GroupId { get; private set; } = groupId;
    public Guid? MembershipId { get; private set; } = membershipId;
    public AuctionAllocationType AllocationType { get; private set; } = allocationType;
    public decimal Amount { get; private set; } = amount;
    public DateTimeOffset CreatedAt { get; private set; } = createdAt;
}
