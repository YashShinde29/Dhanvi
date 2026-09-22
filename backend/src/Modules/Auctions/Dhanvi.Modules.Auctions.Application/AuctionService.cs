using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.SharedKernel.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
namespace Dhanvi.Modules.Auctions.Application;

public sealed partial class AuctionService(IAuctionStore store, IDateTimeProvider clock, GroupMemberPolicy? memberPolicy = null, IAuctionEventHook? events = null, IAuctionScheduleHistoryReader? history = null) : IAuctionService
{
    public Task<AuctionDetails> OpenAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct) => store.ExecuteLockedAsync(groupId, cycleId, actor.UserId, state =>
    {
        Manage(state, actor); Ready(state);
        // A row already exists only when the auction was rescheduled while SCHEDULED; it then opens on its rescheduled window.
        BusinessRuleException.Require(state.Auction is null || state.Auction.Status == AuctionStatus.Scheduled, "AUCTION_ALREADY_EXISTS", "An auction already exists for this cycle.");
        var now = clock.UtcNow; var created = state.Auction is null; var auction = state.Auction ?? Scheduled(state, now); auction.Open(now); state.Auction = auction;
        if (created) Audit(state, actor, "AUCTION_CREATED", now);
        Audit(state, actor, "AUCTION_OPENED", now); return Map(state, actor, now);
    }, ct);
    /// <summary>
    /// The one reschedule use case for organizers and admins. Runs inside the group/cycle/auction row lock: authorization,
    /// authoritative status, validation, update, history, audit and receipt commit together or not at all.
    /// </summary>
    public async Task<AuctionDetails> RescheduleAsync(Guid groupId, Guid cycleId, SelectionActor actor, RescheduleAuctionRequest request, string key, CancellationToken ct)
    {
        AuctionRescheduledEvent? raised = null;
        var details = await store.ExecuteLockedAsync(groupId, cycleId, actor.UserId, state =>
        {
            GroupRules.Require(CanReschedule(state, actor), "AUCTION_PERMISSION_DENIED", "Only the group's approved organizer or a Dhanvi administrator can reschedule this auction.");
            Active(state); Method(state);
            BusinessRuleException.Require(!string.IsNullOrWhiteSpace(key) && key.Length <= 128, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key of at most 128 characters.");
            BusinessRuleException.Require(request.ReasonCode is not null, "AUCTION_RESCHEDULE_REASON_REQUIRED", "Choose a reason for the schedule change.");
            var reasonCode = request.ReasonCode!.Value;
            var (reasonText, memberMessage) = AuctionScheduleChange.ValidateReason(reasonCode, request.ReasonText, request.MemberMessage);
            var newStart = request.NewStartsAt.ToUniversalTime(); var newEnd = request.NewEndsAt.ToUniversalTime();
            var scope = AuctionBidIdempotency.RescheduleScope(groupId, cycleId, actor.UserId);
            var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{scope}\n{newStart:O}\n{newEnd:O}\n{reasonCode}\n{reasonText}\n{memberMessage}")));
            var receipt = state.Receipts.SingleOrDefault(r => r.Scope == scope && r.Key == key);
            // A retried request returns the outcome it already produced: no second history row, no second audit event.
            if (receipt is not null) { receipt.ValidateReplay(fingerprint); return Map(state, actor, clock.UtcNow); }
            BusinessRuleException.Require(state.Selection.ExistingResult is null && state.Result is null, "AUCTION_ALREADY_COMPLETED", "This cycle's auction has a result; its timing is immutable.");
            var now = clock.UtcNow; var created = state.Auction is null; var auction = state.Auction ?? Scheduled(state, now);
            // Optimistic check on top of the row lock: the operator must have seen the schedule they are replacing.
            var currentVersion = created ? 0 : auction.Version;
            BusinessRuleException.Require(request.ExpectedScheduleVersion is null || request.ExpectedScheduleVersion == currentVersion, "AUCTION_SCHEDULE_CONFLICT", "The auction schedule was changed by another user. Review the updated schedule before making another change.");
            var (previousStart, previousEnd) = auction.Reschedule(newStart, newEnd, reasonCode, memberMessage, now);
            state.Auction = auction;
            var role = actor.IsAdmin ? "ADMIN" : "ORGANIZER";
            var change = new AuctionScheduleChange(auction.Id, groupId, cycleId, auction.RescheduleCount, previousStart, previousEnd, newStart, newEnd, reasonCode, reasonText, memberMessage, actor.UserId, role, now);
            state.ScheduleChanges.Add(change);
            state.Receipts.Add(new IdempotencyRecord(scope, key, fingerprint, change.Id, now));
            if (created) Audit(state, actor, "AUCTION_CREATED", now);
            Audit(state, actor, "AUCTION_RESCHEDULED", now, change.Id);
            raised = new(auction.Id, groupId, cycleId, auction.CycleNumber, previousStart, previousEnd, newStart, newEnd, reasonCode, memberMessage, now);
            return Map(state, actor, now);
        }, ct);
        if (raised is not null && events is not null) await events.AuctionRescheduledAsync(raised, ct);
        return details;
    }
    public async Task<AuctionScheduleHistoryPage> ScheduleHistoryAsync(Guid groupId, Guid cycleId, SelectionActor actor, int page, int pageSize, CancellationToken ct)
    {
        // Authorization and the internal/member distinction come from the same context the auction itself uses.
        var inspect = await store.ReadAsync(groupId, cycleId, actor.UserId, state => { SelectionPolicy.AuthorizeReader(state.Selection, actor); Method(state); return CanInspect(state, actor); }, ct);
        return await Reader().ReadAsync(groupId, cycleId, page, pageSize, inspect, ct);
    }
    public async Task<AuctionScheduleHistoryPage> GroupScheduleHistoryAsync(Guid groupId, Guid? cycleId, SelectionActor actor, int page, int pageSize, CancellationToken ct)
    {
        GroupRules.Require(actor.IsAdmin || await Reader().OwnsGroupAsync(groupId, actor.UserId, ct), "AUCTION_PERMISSION_DENIED", "Only the group's organizer or a Dhanvi administrator can view the full schedule history.");
        return await Reader().ReadAsync(groupId, cycleId, page, pageSize, true, ct);
    }
    private IAuctionScheduleHistoryReader Reader() => history ?? throw new InvalidOperationException("Schedule history reader is not configured.");
    public Task<AuctionBidDetails> BidAsync(Guid groupId, Guid cycleId, SelectionActor actor, PlaceAuctionBidRequest request, string key, CancellationToken ct) => store.ExecuteLockedAsync(groupId, cycleId, actor.UserId, state =>
    {
        SelectionPolicy.AuthorizeReader(state.Selection, actor); Method(state);
        var auction = Existing(state);
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(key) && key.Length <= 128, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key of at most 128 characters.");
        var receiptScope = AuctionBidIdempotency.Scope(groupId, cycleId, actor.UserId);
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(receiptScope + "\n" + request.DiscountAmount.ToString("0.00##########################", CultureInfo.InvariantCulture))));
        var receipt = state.Receipts.SingleOrDefault(r => r.Scope == receiptScope && r.Key == key);
        if (receipt is not null) { receipt.ValidateReplay(fingerprint); return AcceptedBidMap(state, state.Bids.Single(b => b.Id == receipt.ResultId)); }
        Active(state); auction.EnsureOpen();
        var participant = state.Selection.Participants.SingleOrDefault(p => p.Membership.UserId == actor.UserId);
        BusinessRuleException.Require(participant is not null, "MEMBER_NOT_ELIGIBLE_TO_BID", "Only active group members can bid.");
        BusinessRuleException.Require(!participant!.Membership.HasBeenSelectedForPayout, "MEMBER_ALREADY_SELECTED_FOR_PAYOUT", "Members already selected for main payout cannot bid again.");
        BusinessRuleException.Require(SelectionPolicy.Eligible(state.Selection).Any(p => p.Membership.Id == participant.Membership.Id), "MEMBER_NOT_ELIGIBLE_TO_BID", "Your membership and current contribution must be eligible.");
        Ready(state);
        var now = clock.UtcNow; var bid = auction.Bid(participant.Membership.Id, request.DiscountAmount, key, now, memberPolicy);
        state.Bids.Add(bid); state.Receipts.Add(new IdempotencyRecord(receiptScope, key, fingerprint, bid.Id, now)); Audit(state, actor, "AUCTION_BID_SUBMITTED", now, bid.Id);
        return AcceptedBidMap(state, bid);
    }, ct);
    public Task<AuctionDetails> CloseAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct) => store.ExecuteLockedAsync(groupId, cycleId, actor.UserId, state =>
    {
        Manage(state, actor); Method(state); var auction = Existing(state); var now = clock.UtcNow;
        if (auction.Status is AuctionStatus.WinnerSelected or AuctionStatus.ClosedNoBids) return Map(state, actor, now);
        auction.EnsureOpen(); Ready(state);
        var winner = Auction.WinningBid(state.Bids);
        if (winner is null) { auction.Close(null, now); Audit(state, actor, "AUCTION_CLOSED", now); Audit(state, actor, "AUCTION_CLOSED_NO_BIDS", now); return Map(state, actor, now); }
        var eligible = SelectionPolicy.Eligible(state.Selection);
        var participant = eligible.SingleOrDefault(p => p.Membership.Id == winner.MembershipId);
        BusinessRuleException.Require(participant is not null, "MEMBER_NOT_ELIGIBLE_TO_BID", "The highest bidder is no longer eligible. The auction remains unresolved for authorized intervention.");
        var member = participant!.Membership;
        var selection = SelectionResult.Auction(groupId, cycleId, auction.CycleNumber, new(member.Id, member.SlotNumber!.Value), member.UserId, actor.UserId, now,
            eligible.Select(p => new EligibleMember(p.Membership.Id, p.Membership.SlotNumber!.Value)).ToArray(), winner.Id);
        // Obligations identify every original member position, including prior main-payout recipients.
        var recipients = state.Selection.Contributions.Select(c => c.MembershipId).ToArray();
        state.Result = AuctionResult.Create(auction, winner, selection.Id, recipients, actor.UserId, now, memberPolicy); state.NewSelection = selection;
        auction.Close(winner, now); member.SelectForPayout(auction.CycleNumber, now); state.Selection.Cycle.CompleteSelection(selection.Id, now);
        foreach (var action in FinalizationActions) Audit(state, actor, action, now, state.Result.Id, selection);
        return Map(state, actor, now);
    }, ct);
    private static readonly string[] FinalizationActions = ["AUCTION_CLOSED", "AUCTION_WINNER_SELECTED", "AUCTION_CALCULATION_FINALIZED", "AUCTION_MEMBER_BENEFITS_CALCULATED", "AUCTION_PLATFORM_FEE_CALCULATED", "CYCLE_AUCTION_SELECTION_COMPLETED", "MEMBER_SELECTED_FOR_PAYOUT"];
    private static void Active(AuctionContext state)
    {
        BusinessRuleException.Require(state.Selection.Group.Status != GroupStatus.Suspended, "GROUP_SUSPENDED", "Auction operations are blocked while the group is suspended.");
        BusinessRuleException.Require(state.Selection.Group.Status == GroupStatus.Active, "GROUP_NOT_ACTIVE", "Group must be active.");
    }
    private static bool CanManage(AuctionContext state, SelectionActor actor) => state.Selection.ActorActive &&
        (state.Selection.Group.CreatorType == GroupCreatorType.Platform ? actor.IsAdmin : state.Selection.Group.CreatedByUserId == actor.UserId && state.Selection.OrganizerApproved);
    private static bool CanInspect(AuctionContext state, SelectionActor actor) => actor.IsAdmin || state.Selection.Group.CreatorType == GroupCreatorType.Organizer && state.Selection.Group.CreatedByUserId == actor.UserId;
    // Rescheduling authority: an admin for any group; the owning approved organizer for their own group. Membership grants nothing.
    private static bool CanReschedule(AuctionContext state, SelectionActor actor) => state.Selection.ActorActive &&
        (actor.IsAdmin || state.Selection.Group.CreatorType == GroupCreatorType.Organizer && state.Selection.Group.CreatedByUserId == actor.UserId && state.Selection.OrganizerApproved);
    private static void Manage(AuctionContext state, SelectionActor actor)
    {
        GroupRules.Require(CanManage(state, actor), "NOT_AUTHORIZED_TO_MANAGE_AUCTION", "Only the owning approved organizer or a platform-group administrator can manage this auction."); Active(state);
    }
    private static void Method(AuctionContext state) => BusinessRuleException.Require(state.Selection.Cycle.SelectionMethod == SelectionMethod.Auction, "CYCLE_NOT_AUCTION", "This cycle does not use auction selection.");
    private static void Ready(AuctionContext state) { Method(state); BusinessRuleException.Require(state.Selection.ExistingResult is null, "AUCTION_RESULT_ALREADY_EXISTS", "A selection result already exists."); SelectionPolicy.RequireContributionsReady(state.Selection); }
    private static Auction Existing(AuctionContext state) => state.Auction ?? throw new BusinessRuleException("AUCTION_NOT_FOUND", "The auction has not been opened.");
    private Auction Scheduled(AuctionContext state, DateTimeOffset now)
    {
        var group = state.Selection.Group; var cycle = state.Selection.Cycle;
        var rules = group.Rules.AuctionRules ?? throw new BusinessRuleException("INVALID_AUCTION_RULES", "Published auction configuration is required.");
        // Prompt 3 published these TimeOnly values as UTC clock times. SelectionDate
        // supplies the calendar label; do not reinterpret existing rules as local times.
        var zone = TimeZoneInfo.Utc;
        DateTimeOffset Utc(TimeOnly time) => new(TimeZoneInfo.ConvertTimeToUtc(cycle.SelectionDate.ToDateTime(time, DateTimeKind.Unspecified), zone));
        return Auction.Schedule(group.Id, cycle.Id, cycle.CycleNumber, group.GroupValue, group.MemberLimit, rules, Utc(rules.AuctionStartTime), Utc(rules.AuctionEndTime), now, memberPolicy);
    }
    private static void Audit(AuctionContext state, SelectionActor actor, string action, DateTimeOffset now, Guid? subject = null, SelectionResult? selection = null) =>
        state.Audit.Add(new(state.Selection.Group.Id, actor.UserId, action, now, subject ?? state.Auction?.Id, state.Selection.Cycle.Id, selection?.Id, selection?.WinnerMembershipId, AuctionCalculator.Version));
}
