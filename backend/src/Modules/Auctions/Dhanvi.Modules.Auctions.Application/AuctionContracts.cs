using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.SharedKernel.Domain;
namespace Dhanvi.Modules.Auctions.Application;
public sealed class AuctionContext(SelectionContext selection)
{
    public SelectionContext Selection { get; } = selection;
    public Auction? Auction { get; set; }
    public AuctionResult? Result { get; set; }
    public SelectionResult? NewSelection { get; set; }
    public List<AuctionBid> Bids { get; init; } = [];
    public List<IdempotencyRecord> Receipts { get; init; } = [];
    public List<GroupAuditEvent> Audit { get; init; } = [];
}
public interface IAuctionStore
{
    Task<T> ReadAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> read, CancellationToken ct);
    Task<T> ExecuteLockedAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> execute, CancellationToken ct);
}
public sealed record PlaceAuctionBidRequest(decimal DiscountAmount);
public sealed record AuctionBidDetails(Guid BidId, decimal DiscountAmount, long SequenceNumber, bool IsCurrentWinningBid,
    decimal CurrentHighestDiscount, decimal PotentialWinnerPayout, DateTimeOffset SubmittedAt, int? MemberSlot = null);
public sealed record AuctionAllocationDetails(Guid? MembershipId, AuctionAllocationType AllocationType, decimal Amount);
public sealed record AuctionAuditDetails(string Action, DateTimeOffset CreatedAt, Guid? SubjectId);
public sealed record AuctionResultDetails(Guid Id, Guid WinningBidId, SelectionWinner Winner, decimal GroupValue, decimal WinningDiscount,
    decimal WinnerPayout, decimal GrossMemberShare, decimal PlatformFee, decimal MemberBenefitPool, int NonWinnerCount,
    AuctionFeePolicy FeePolicy, string CalculationVersion, DateTimeOffset FinalizedAt, decimal? MyBenefitAllocation,
    IReadOnlyList<AuctionAllocationDetails> Allocations, string AllocationStatus = "CALCULATED_PENDING_SETTLEMENT");
public sealed record AuctionDetails(Guid? Id, int CycleNumber, string Status, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    DateTimeOffset ServerTime, DateTimeOffset? OpenedAt, DateTimeOffset? ClosedAt, DateTimeOffset? WinnerSelectedAt,
    decimal MinimumDiscount, decimal MaximumDiscount, decimal BidIncrement, decimal CurrentHighestDiscount,
    decimal MinimumNextBid, decimal PotentialWinnerPayout, long BidCount, int EligibleBidderCount, bool CanManage, bool CanOpen,
    bool CanClose, bool CanBid, string? BidUnavailableReason, IReadOnlyList<AuctionBidDetails> MyBids,
    IReadOnlyList<AuctionBidDetails> OperationalBids, IReadOnlyList<AuctionAuditDetails> AuditHistory, AuctionResultDetails? Result);
public interface IAuctionService
{
    Task<AuctionDetails> GetAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionDetails> OpenAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionDetails> CloseAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionBidDetails> BidAsync(Guid groupId, Guid cycleId, SelectionActor actor, PlaceAuctionBidRequest request, string key, CancellationToken ct);
    Task<IReadOnlyList<AuctionBidDetails>> MyBidsAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionResultDetails> ResultAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
}
