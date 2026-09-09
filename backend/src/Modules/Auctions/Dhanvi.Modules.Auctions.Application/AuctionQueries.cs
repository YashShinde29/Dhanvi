using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Auctions.Application;
public sealed partial class AuctionService
{
    public Task<AuctionDetails> GetAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct) => store.ReadAsync(groupId, cycleId, actor.UserId, state =>
    { SelectionPolicy.AuthorizeReader(state.Selection, actor); Method(state); return Map(state, actor, clock.UtcNow); }, ct);
    public Task<IReadOnlyList<AuctionBidDetails>> MyBidsAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct) => store.ReadAsync<IReadOnlyList<AuctionBidDetails>>(groupId, cycleId, actor.UserId, state =>
    { SelectionPolicy.AuthorizeReader(state.Selection, actor); Method(state); return OwnBids(state, actor); }, ct);
    public Task<AuctionResultDetails> ResultAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct) => store.ReadAsync(groupId, cycleId, actor.UserId, state =>
    {
        SelectionPolicy.AuthorizeReader(state.Selection, actor); Method(state);
        BusinessRuleException.Require(state.Result is not null, state.Auction?.Status == AuctionStatus.ClosedNoBids ? "AUCTION_HAS_NO_BIDS" : "AUCTION_RESULT_NOT_FOUND", "No auction winner calculation exists.");
        return ResultMap(state, actor);
    }, ct);
    private static AuctionBidDetails BidMap(AuctionContext state, AuctionBid bid, bool inspect = false) => new(bid.Id, bid.DiscountAmount, bid.SequenceNumber,
        state.Auction?.CurrentWinningBidId == bid.Id, state.Auction?.CurrentHighestDiscount ?? 0, state.Selection.Group.GroupValue - bid.DiscountAmount, bid.SubmittedAt,
        inspect ? state.Selection.Participants.Single(p => p.Membership.Id == bid.MembershipId).Membership.SlotNumber : null);
    private static IReadOnlyList<AuctionBidDetails> OwnBids(AuctionContext state, SelectionActor actor)
    {
        var membership = state.Selection.Participants.SingleOrDefault(p => p.Membership.UserId == actor.UserId)?.Membership.Id;
        return state.Bids.Where(b => b.MembershipId == membership).OrderByDescending(b => b.SequenceNumber).Select(b => BidMap(state, b)).ToArray();
    }
    private static AuctionResultDetails ResultMap(AuctionContext state, SelectionActor actor)
    {
        var result = state.Result!; var winner = state.Selection.Participants.Single(p => p.Membership.Id == result.WinnerMembershipId);
        var own = state.Selection.Participants.SingleOrDefault(p => p.Membership.UserId == actor.UserId)?.Membership.Id;
        return new(result.Id, result.WinningBidId, new(winner.Membership.Id, winner.Membership.SlotNumber!.Value, winner.DisplayName), result.GroupValue, result.WinningDiscount,
            result.WinnerPayout, result.GrossMemberShare, result.PlatformFee, result.MemberBenefitPool, result.MemberLimit - 1, result.FeePolicy, result.CalculationVersion, result.FinalizedAt,
            own.HasValue ? result.Allocations.Where(a => a.MembershipId == own).Sum(a => a.Amount) : null,
            CanInspect(state, actor) ? result.Allocations.Select(a => new AuctionAllocationDetails(a.MembershipId, a.AllocationType, a.Amount)).ToArray() : []);
    }
    private static AuctionDetails Map(AuctionContext state, SelectionActor actor, DateTimeOffset now)
    {
        var auction = state.Auction ?? Scheduled(state, now); var eligible = SelectionPolicy.Eligible(state.Selection); var own = state.Selection.Participants.SingleOrDefault(p => p.Membership.UserId == actor.UserId);
        var active = state.Selection.Group.Status == GroupStatus.Active; var ready = state.Selection.Cycle.Status == CycleStatus.ReadyForSelection;
        var manage = CanManage(state, actor); var inspect = CanInspect(state, actor); var window = now >= auction.StartsAt && now < auction.EndsAt;
        var next = auction.LastBidSequence > 0 ? auction.CurrentHighestDiscount + auction.BidIncrement : Math.Max(auction.MinimumDiscount, state.Selection.Group.MemberLimit / 100m);
        var canBid = active && ready && window && auction.Status == AuctionStatus.Open && next <= auction.MaximumDiscount && eligible.Any(p => p.Membership.UserId == actor.UserId);
        var reason = canBid ? null : !active ? "Group is not active." : own?.Membership.HasBeenSelectedForPayout == true ? "You already hold a main payout right." :
            auction.Status != AuctionStatus.Open ? "Auction is not open." : !window ? "Outside the configured auction window." : next > auction.MaximumDiscount ? "Maximum discount has been reached." : "An active membership and fully recorded contribution are required.";
        return new(state.Auction?.Id, auction.CycleNumber, auction.Status.ToString(), auction.StartsAt, auction.EndsAt, now, auction.OpenedAt, auction.ClosedAt, auction.WinnerSelectedAt,
            auction.MinimumDiscount, auction.MaximumDiscount, auction.BidIncrement, auction.CurrentHighestDiscount, next, auction.GroupValue - auction.CurrentHighestDiscount,
            auction.LastBidSequence, eligible.Count, manage, manage && active && ready && state.Auction is null && window, manage && active && ready && auction.Status == AuctionStatus.Open,
            canBid, reason, OwnBids(state, actor), inspect ? state.Bids.OrderBy(b => b.SequenceNumber).Select(b => BidMap(state, b, true)).ToArray() : [],
            inspect ? state.Audit.Where(a => a.CycleId == auction.CycleId && a.AlgorithmVersion == AuctionCalculator.Version).OrderBy(a => a.CreatedAt).Select(a => new AuctionAuditDetails(a.Action, a.CreatedAt, a.SubjectId)).ToArray() : [],
            state.Result is null ? null : ResultMap(state, actor));
    }
}
