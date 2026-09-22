using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Auctions.Domain;

public enum AuctionStatus { Scheduled, Open, Closed, WinnerSelected, ClosedNoBids }
/// <summary>Why a scheduled auction was moved. Members see the code (as a label) and the member message, never the internal text.</summary>
public enum AuctionScheduleReason { PublicHoliday, TechnicalIssue, OperationalIssue, OrganizerRequest, IncorrectSchedule, MemberAvailability, Emergency, Other }
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
    /// <summary>How many times the scheduled window was moved; each move is an <see cref="AuctionScheduleChange"/>.</summary>
    public int RescheduleCount { get; private set; }
    public DateTimeOffset? LastRescheduledAt { get; private set; }
    public bool WasRescheduled => RescheduleCount > 0;
    // Latest-change summary, denormalized so reads never touch the history table: the window as first scheduled, the window
    // replaced by the most recent change, and the member-safe reason of that change.
    public DateTimeOffset OriginalStartsAt { get; private set; }
    public DateTimeOffset OriginalEndsAt { get; private set; }
    public DateTimeOffset? PreviousStartsAt { get; private set; }
    public DateTimeOffset? PreviousEndsAt { get; private set; }
    public AuctionScheduleReason? LatestReasonCode { get; private set; }
    public string? LatestMemberMessage { get; private set; }
    public static Auction Schedule(Guid groupId, Guid cycleId, int number, decimal value, int members, AuctionGroupRules rules, DateTimeOffset start, DateTimeOffset end, DateTimeOffset now, GroupMemberPolicy? memberPolicy = null)
    {
        BusinessRuleException.Require(start < end && rules.MinimumDiscount >= 0 && rules.MinimumDiscount <= rules.MaximumDiscount && rules.BidIncrement > 0 && rules.BidIncrement < value,
            "INVALID_AUCTION_RULES", "Auction limits, increment and window must be valid.");
        AuctionCalculator.Calculate(value, members, rules.MaximumDiscount, rules.FeePolicy, memberPolicy);
        BusinessRuleException.Require(rules.MinimumDiscount * 100 % members == 0 && rules.BidIncrement * 100 % members == 0,
            "INVALID_AUCTION_ALLOCATION_PRECISION", "Configured limits and increment must support exact member shares.");
        return new() { GroupId = groupId, CycleId = cycleId, CycleNumber = number, GroupValue = value, MemberLimit = members,
            MinimumDiscount = rules.MinimumDiscount, MaximumDiscount = rules.MaximumDiscount, BidIncrement = rules.BidIncrement, FeePolicy = rules.FeePolicy,
            StartsAt = start, EndsAt = end, OriginalStartsAt = start, OriginalEndsAt = end, CreatedAt = now, UpdatedAt = now, Status = AuctionStatus.Scheduled };
    }
    /// <summary>
    /// Moves a SCHEDULED, bid-free auction to a new window. The previous window is returned so the caller records it in the
    /// append-only history inside the same transaction; StartsAt/EndsAt stay the single authoritative schedule.
    /// </summary>
    public (DateTimeOffset PreviousStartsAt, DateTimeOffset PreviousEndsAt) Reschedule(DateTimeOffset newStartsAt, DateTimeOffset newEndsAt, AuctionScheduleReason reasonCode, string? memberMessage, DateTimeOffset now)
    {
        BusinessRuleException.Require(Status != AuctionStatus.Open, "AUCTION_ALREADY_OPEN", "Schedule changes are unavailable after bidding begins.");
        BusinessRuleException.Require(Status == AuctionStatus.Scheduled, "AUCTION_ALREADY_COMPLETED", "A closed auction's timing is part of its record and cannot change.");
        BusinessRuleException.Require(LastBidSequence == 0, "AUCTION_RESCHEDULE_NOT_ALLOWED", "Bids exist for an auction that is not open; the auction state is inconsistent and needs review before any schedule change.");
        BusinessRuleException.Require(newStartsAt < newEndsAt, "AUCTION_INVALID_TIME_RANGE", "The auction must end after it starts.");
        BusinessRuleException.Require(newStartsAt > now, "AUCTION_NEW_START_IN_PAST", "The new start must be in the future.");
        BusinessRuleException.Require(newStartsAt != StartsAt || newEndsAt != EndsAt, "AUCTION_SCHEDULE_UNCHANGED", "Choose a different date or time; this is the current schedule.");
        var previous = (StartsAt, EndsAt);
        PreviousStartsAt = StartsAt; PreviousEndsAt = EndsAt; LatestReasonCode = reasonCode; LatestMemberMessage = memberMessage;
        StartsAt = newStartsAt; EndsAt = newEndsAt; RescheduleCount++; LastRescheduledAt = now; Touch(now);
        return previous;
    }
    public void Open(DateTimeOffset now)
    {
        BusinessRuleException.Require(Status == AuctionStatus.Scheduled, "AUCTION_ALREADY_EXISTS", "This auction has already been opened or closed.");
        BusinessRuleException.Require(now >= StartsAt && now < EndsAt, "AUCTION_OUTSIDE_WINDOW", "Open the auction within its configured time window.");
        Status = AuctionStatus.Open; OpenedAt = now; Touch(now);
    }
    public AuctionBid Bid(Guid membershipId, decimal discount, string key, DateTimeOffset now, GroupMemberPolicy? memberPolicy = null)
    {
        EnsureOpen();
        BusinessRuleException.Require(now >= OpenedAt && now >= StartsAt && now < EndsAt, "AUCTION_OUTSIDE_WINDOW", "Bidding is outside the server-authoritative auction window.");
        AuctionCalculator.Calculate(GroupValue, MemberLimit, discount, FeePolicy, memberPolicy);
        BusinessRuleException.Require(discount >= MinimumDiscount, "DISCOUNT_BELOW_MINIMUM", "Discount is below the configured minimum.");
        BusinessRuleException.Require(discount <= MaximumDiscount, "DISCOUNT_ABOVE_MAXIMUM", "Discount exceeds the configured maximum.");
        BusinessRuleException.Require(LastBidSequence == 0 || discount >= CurrentHighestDiscount + BidIncrement, "BID_INCREMENT_NOT_MET", "Increase the current highest discount by at least the configured increment.");
        var bid = new AuctionBid(Id, GroupId, CycleId, membershipId, discount, checked(LastBidSequence + 1), key, now);
        LastBidSequence = bid.SequenceNumber; CurrentHighestDiscount = discount; CurrentWinningBidId = bid.Id; CurrentWinningMembershipId = membershipId; Touch(now); return bid;
    }
    public static AuctionBid? WinningBid(IEnumerable<AuctionBid> bids) => bids.OrderByDescending(b => b.DiscountAmount).ThenBy(b => b.SequenceNumber).FirstOrDefault();
    public void Close(AuctionBid? winner, DateTimeOffset now)
    {
        EnsureOpen();
        BusinessRuleException.Require(winner is null ? LastBidSequence == 0 : winner.AuctionId == Id && winner.Id == CurrentWinningBidId && winner.DiscountAmount == CurrentHighestDiscount,
            "AUCTION_HISTORY_INCONSISTENT", "The authoritative bid history and current auction state do not agree.");
        ClosedAt = now;
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
    // PostgreSQL stores microseconds; normalize before returning the original receipt.
    public DateTimeOffset SubmittedAt { get; private set; } = new DateTimeOffset(submittedAt.Ticks - submittedAt.Ticks % 10, submittedAt.Offset).ToUniversalTime();
}
/// <summary>Append-only record of one schedule change. Never updated; the auction's RescheduleCount is its sequence.</summary>
public sealed class AuctionScheduleChange
{
    private AuctionScheduleChange() { }
    public const int MinOtherReasonLength = 5, MaxReasonLength = 500, MaxMemberMessageLength = 300;
    public AuctionScheduleChange(Guid auctionId, Guid groupId, Guid cycleId, int changeSequence, DateTimeOffset previousStartsAt, DateTimeOffset previousEndsAt,
        DateTimeOffset newStartsAt, DateTimeOffset newEndsAt, AuctionScheduleReason reasonCode, string? reasonText, string? memberMessage, Guid changedByUserId, string changedByRole, DateTimeOffset changedAt)
    {
        BusinessRuleException.Require(changeSequence > 0 && previousStartsAt < previousEndsAt && newStartsAt < newEndsAt, "AUCTION_INVALID_TIME_RANGE", "Schedule history requires valid windows.");
        (reasonText, memberMessage) = ValidateReason(reasonCode, reasonText, memberMessage);
        AuctionId = auctionId; GroupId = groupId; CycleId = cycleId; ChangeSequence = changeSequence; PreviousStartsAt = previousStartsAt; PreviousEndsAt = previousEndsAt;
        NewStartsAt = newStartsAt; NewEndsAt = newEndsAt; ReasonCode = reasonCode; ReasonText = reasonText; MemberMessage = memberMessage;
        ChangedByUserId = changedByUserId; ChangedByRole = changedByRole; ChangedAt = changedAt; CreatedAt = changedAt;
    }
    /// <summary>A code is always required; OTHER needs a meaningful explanation. Texts are trimmed and bounded; blank becomes null.</summary>
    public static (string? ReasonText, string? MemberMessage) ValidateReason(AuctionScheduleReason reasonCode, string? reasonText, string? memberMessage)
    {
        BusinessRuleException.Require(Enum.IsDefined(reasonCode), "AUCTION_RESCHEDULE_REASON_REQUIRED", "Choose a valid reason for the schedule change.");
        var text = string.IsNullOrWhiteSpace(reasonText) ? null : reasonText.Trim(); var message = string.IsNullOrWhiteSpace(memberMessage) ? null : memberMessage.Trim();
        BusinessRuleException.Require(reasonCode != AuctionScheduleReason.Other || (text is not null && text.Length >= MinOtherReasonLength), "AUCTION_RESCHEDULE_REASON_REQUIRED", $"Explain the reason in at least {MinOtherReasonLength} characters when choosing Other.");
        BusinessRuleException.Require(text is null || text.Length <= MaxReasonLength, "AUCTION_RESCHEDULE_REASON_REQUIRED", $"Keep the explanation within {MaxReasonLength} characters.");
        BusinessRuleException.Require(message is null || message.Length <= MaxMemberMessageLength, "AUCTION_RESCHEDULE_REASON_REQUIRED", $"Keep the member message within {MaxMemberMessageLength} characters.");
        return (text, message);
    }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid AuctionId { get; private set; }
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public int ChangeSequence { get; private set; }
    public DateTimeOffset PreviousStartsAt { get; private set; }
    public DateTimeOffset PreviousEndsAt { get; private set; }
    public DateTimeOffset NewStartsAt { get; private set; }
    public DateTimeOffset NewEndsAt { get; private set; }
    public AuctionScheduleReason ReasonCode { get; private set; }
    /// <summary>Internal explanation for operators (tickets, incident ids). Never shown to members.</summary>
    public string? ReasonText { get; private set; }
    /// <summary>Optional plain-language note written for members.</summary>
    public string? MemberMessage { get; private set; }
    public Guid ChangedByUserId { get; private set; }
    /// <summary>"ADMIN" or "ORGANIZER" — the authority used, derived by the backend from the session, never from the client.</summary>
    public string ChangedByRole { get; private set; } = string.Empty;
    public DateTimeOffset ChangedAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
}
