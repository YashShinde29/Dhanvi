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
    /// <summary>Changes appended by the current operation. Existing history is never loaded here — it is paged through <see cref="IAuctionScheduleHistoryReader"/>.</summary>
    public List<AuctionScheduleChange> ScheduleChanges { get; init; } = [];
    public List<IdempotencyRecord> Receipts { get; init; } = [];
    public List<GroupAuditEvent> Audit { get; init; } = [];
}
public interface IAuctionStore
{
    Task<T> ReadAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> read, CancellationToken ct);
    Task<T> ExecuteLockedAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> execute, CancellationToken ct);
}
public sealed record PlaceAuctionBidRequest(decimal DiscountAmount);
/// <summary>
/// Move a SCHEDULED auction. Both instants are absolute (UTC on the wire); the client converts the group-time-zone wall clock.
/// <paramref name="ExpectedScheduleVersion"/> is the ScheduleVersion the operator saw; a mismatch means someone else changed it first.
/// </summary>
public sealed record RescheduleAuctionRequest(DateTimeOffset NewStartsAt, DateTimeOffset NewEndsAt, AuctionScheduleReason? ReasonCode, string? ReasonText = null, string? MemberMessage = null, int? ExpectedScheduleVersion = null);
/// <summary>
/// One history row. <paramref name="ReasonText"/>, <paramref name="ChangedByRole"/> and <paramref name="ChangedByName"/> are null
/// for members — they receive the reason code and member message only.
/// </summary>
public sealed record AuctionScheduleChangeDetails(Guid Id, Guid CycleId, int CycleNumber, int ChangeSequence, DateTimeOffset PreviousStartsAt, DateTimeOffset PreviousEndsAt, DateTimeOffset NewStartsAt, DateTimeOffset NewEndsAt,
    AuctionScheduleReason ReasonCode, string? ReasonText, string? MemberMessage, string? ChangedByRole, string? ChangedByName, DateTimeOffset ChangedAt);
public sealed record AuctionScheduleHistoryPage(IReadOnlyList<AuctionScheduleChangeDetails> Items, int Page, int PageSize, int TotalCount);
/// <summary>Paged, newest-first history. Implemented in infrastructure with server-side paging; never loads a whole group's history.</summary>
public interface IAuctionScheduleHistoryReader
{
    Task<AuctionScheduleHistoryPage> ReadAsync(Guid groupId, Guid? cycleId, int page, int pageSize, bool includeInternal, CancellationToken ct);
    /// <summary>True when the user is the approved organizer who created the group.</summary>
    Task<bool> OwnsGroupAsync(Guid groupId, Guid userId, CancellationToken ct);
}
/// <summary>Raised after a reschedule commits so a notification layer (Prompt 10) can inform members. Member-safe payload only: no internal reason text, no actor identity.</summary>
public sealed record AuctionRescheduledEvent(Guid AuctionId, Guid GroupId, Guid CycleId, int CycleNumber, DateTimeOffset OldStartsAt, DateTimeOffset OldEndsAt, DateTimeOffset NewStartsAt, DateTimeOffset NewEndsAt, AuctionScheduleReason ReasonCode, string? MemberMessage, DateTimeOffset ChangedAt);
public interface IAuctionEventHook { Task AuctionRescheduledAsync(AuctionRescheduledEvent notification, CancellationToken ct); }
public sealed class NoopAuctionEventHook : IAuctionEventHook { public Task AuctionRescheduledAsync(AuctionRescheduledEvent notification, CancellationToken ct) => Task.CompletedTask; }
public sealed record AuctionBidDetails(Guid BidId, decimal DiscountAmount, long SequenceNumber, bool IsCurrentWinningBid,
    decimal CurrentHighestDiscount, decimal PotentialWinnerPayout, DateTimeOffset SubmittedAt, int? MemberSlot = null);
public sealed record AuctionAllocationDetails(Guid? MembershipId, AuctionAllocationType AllocationType, decimal Amount);
public sealed record AuctionAuditDetails(string Action, DateTimeOffset CreatedAt, Guid? SubjectId);
public sealed record AuctionResultDetails(Guid Id, Guid WinningBidId, SelectionWinner Winner, decimal GroupValue, decimal WinningDiscount,
    decimal WinnerPayout, decimal GrossMemberShare, decimal PlatformFee, decimal MemberBenefitPool, int NonWinnerCount,
    AuctionFeePolicy FeePolicy, string CalculationVersion, DateTimeOffset FinalizedAt, decimal? MyBenefitAllocation,
    IReadOnlyList<AuctionAllocationDetails> Allocations, string AllocationStatus = "CALCULATED_PENDING_SETTLEMENT");
/// <summary>One accepted bid as members may see it: amount, time and the bidder's member position only (no identity).</summary>
public sealed record AuctionActivityDetails(decimal DiscountAmount, DateTimeOffset SubmittedAt, int MemberSlot, bool IsMine, bool IsCurrentHighest);
public sealed record AuctionDetails(Guid? Id, int CycleNumber, string Status, DateTimeOffset StartsAt, DateTimeOffset EndsAt,
    DateTimeOffset ServerTime, DateTimeOffset? OpenedAt, DateTimeOffset? ClosedAt, DateTimeOffset? WinnerSelectedAt,
    decimal MinimumDiscount, decimal MaximumDiscount, decimal BidIncrement, decimal CurrentHighestDiscount,
    decimal MinimumNextBid, decimal PotentialWinnerPayout, long BidCount, int EligibleBidderCount, bool CanManage, bool CanOpen,
    bool CanClose, bool CanBid, string? BidUnavailableReason, IReadOnlyList<AuctionBidDetails> MyBids,
    IReadOnlyList<AuctionBidDetails> OperationalBids, IReadOnlyList<AuctionAuditDetails> AuditHistory, AuctionResultDetails? Result,
    decimal GroupValue = 0, string GroupName = "", int DurationMonths = 0, IReadOnlyList<AuctionActivityDetails>? RecentBids = null, int? CurrentLeaderSlot = null,
    // Scheduling: every viewer learns the auction moved and from when; only operators (CanInspect) receive the full history.
    // Latest-change summary only (denormalized on the auction row): full history is a separate paged endpoint.
    bool WasRescheduled = false, DateTimeOffset? LastRescheduledAt = null, int RescheduleCount = 0, DateTimeOffset? OriginalStartsAt = null, DateTimeOffset? OriginalEndsAt = null,
    DateTimeOffset? PreviousStartsAt = null, DateTimeOffset? PreviousEndsAt = null, AuctionScheduleReason? LatestReasonCode = null, string? LatestMemberMessage = null,
    bool CanReschedule = false, string? RescheduleUnavailableReason = null, int ScheduleVersion = 0);
public interface IAuctionService
{
    Task<AuctionDetails> GetAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionDetails> OpenAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionDetails> CloseAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionDetails> RescheduleAsync(Guid groupId, Guid cycleId, SelectionActor actor, RescheduleAuctionRequest request, string key, CancellationToken ct);
    /// <summary>History of this cycle's auction only, newest first, paged. Members get the sanitized view.</summary>
    Task<AuctionScheduleHistoryPage> ScheduleHistoryAsync(Guid groupId, Guid cycleId, SelectionActor actor, int page, int pageSize, CancellationToken ct);
    /// <summary>Every cycle's history for one group (admin: any group; organizer: own group), optional cycle filter, paged.</summary>
    Task<AuctionScheduleHistoryPage> GroupScheduleHistoryAsync(Guid groupId, Guid? cycleId, SelectionActor actor, int page, int pageSize, CancellationToken ct);
    Task<AuctionBidDetails> BidAsync(Guid groupId, Guid cycleId, SelectionActor actor, PlaceAuctionBidRequest request, string key, CancellationToken ct);
    Task<IReadOnlyList<AuctionBidDetails>> MyBidsAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<AuctionResultDetails> ResultAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
}
