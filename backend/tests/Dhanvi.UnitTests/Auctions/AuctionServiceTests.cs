using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;

namespace Dhanvi.UnitTests.Auctions;

public sealed class AuctionServiceTests
{
    private sealed class Clock : IDateTimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = new(2030, 1, 2, 10, 0, 0, TimeSpan.Zero);
    }
    private sealed class Store(AuctionContext state) : IAuctionStore
    {
        public Task<T> ReadAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> read, CancellationToken ct) => Task.FromResult(read(state));
        public Task<T> ExecuteLockedAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> execute, CancellationToken ct) => Task.FromResult(execute(state));
    }
    private sealed class Scenario
    {
        public required AuctionContext State { get; init; }
        public required AuctionService Service { get; init; }
        public required Clock Clock { get; init; }
        public SelectionActor Owner => new(State.Selection.Group.CreatedByUserId, false);
        public SelectionActor Member(int index = 0) => new(State.Selection.Participants[index].Membership.UserId, false);
        public Task<AuctionDetails> Open(SelectionActor? actor = null) => Service.OpenAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Owner, default);
        public Task<AuctionDetails> Get(SelectionActor? actor = null) => Service.GetAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Member(), default);
        public Task<AuctionDetails> Close() => Service.CloseAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, Owner, default);
        public Task<AuctionBidDetails> Bid(decimal amount = 150000, string key = "key", SelectionActor? actor = null) =>
            Service.BidAsync(State.Selection.Group.Id, State.Selection.Cycle.Id, actor ?? Member(), new(amount), key, default);
    }
    private static Scenario Create(GroupType type = GroupType.Auction, bool reserved = false, bool complete = true, AuctionGroupRules? configured = null)
    {
        var now = new DateTimeOffset(2029, 1, 1, 0, 0, 0, TimeSpan.Zero); var owner = Guid.NewGuid();
        var group = Group.Create("Auction test", "", GroupCreatorType.Organizer, owner,
            new(type, 500000, 20, reserved, reserved, 1, 2, 2, new(2030, 1, 1),
                type == GroupType.Auction ? configured ?? new(50000, 200000, 5000, new(10, 0), new(11, 0)) : null), true, now);
        var rules = group.Publish(true, now); var participants = new List<SelectionParticipant>();
        for (var i = 0; i < 20; i++)
        {
            var member = GroupMembership.Apply(group.Id, reserved && i == 0 ? owner : Guid.NewGuid(), now);
            member.Approve(reserved && i == 0 ? 1 : group.ApproveMember(now), now); member.Accept(rules, now);
            participants.Add(new(member, true, "Member"));
        }
        group.ConfirmReady(true, 20, true, now); group.Activate(20, true, true, false, now);
        foreach (var participant in participants) participant.Membership.Activate(now);
        var cycle = CycleSchedule.Generate(group, now)[0];
        var contributions = participants.Select(p => Contribution.Expect(group.Id, cycle.Id, p.Membership.Id, 25000, cycle.ContributionDueDate, now)).ToArray();
        foreach (var contribution in contributions.Take(complete ? 20 : 19)) contribution.Record(25000, "manual", null, "key", owner, new(2029, 1, 1), now);
        cycle.Recalculate(complete ? 500000 : 475000, complete ? 20 : 19, 20, now);
        var state = new AuctionContext(new(group, cycle, participants, contributions, true, true, null)); var clock = new Clock();
        return new() { State = state, Clock = clock, Service = new(new Store(state), clock) };
    }

    [Fact]
    public async Task UtcConfigurationIsNotReinterpretedAsIst()
    {
        var s = Create(); var preview = await s.Get();
        Assert.Equal("Asia/Kolkata", s.State.Selection.Group.GroupTimeZone);
        Assert.Equal(new DateTimeOffset(2030, 1, 2, 10, 0, 0, TimeSpan.Zero), preview.StartsAt);
        Assert.Equal(preview.StartsAt.AddHours(1), preview.EndsAt);
        Assert.Equal(new TimeOnly(15, 30), TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(preview.StartsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata")).DateTime));
        s.Clock.UtcNow = preview.StartsAt.AddMinutes(-330);
        Assert.Equal("AUCTION_OUTSIDE_WINDOW", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Open())).Code);
        s.Clock.UtcNow = preview.StartsAt;
        Assert.Equal("OPEN", (await s.Open()).Status);
        s.Clock.UtcNow = preview.EndsAt;
        Assert.False((await s.Get()).CanBid);
        Assert.Equal("AUCTION_OUTSIDE_WINDOW", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid())).Code);
    }

    [Theory]
    [InlineData(GroupType.Random, false)]
    [InlineData(GroupType.Auction, true)]
    public async Task RandomAndOrganizerReservedCyclesCannotOpenAuction(GroupType type, bool reserved)
    {
        var s = Create(type, reserved);
        Assert.Equal("CYCLE_NOT_AUCTION", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Open())).Code);
        Assert.Null(s.State.Auction);
    }

    [Fact]
    public async Task OnlyOwningOrganizerCanManage()
    {
        var s = Create();
        Assert.Equal("NOT_AUTHORIZED_TO_MANAGE_AUCTION", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.Open(new(Guid.NewGuid(), false)))).Code);
        Assert.Equal("NOT_AUTHORIZED_TO_MANAGE_AUCTION", (await Assert.ThrowsAsync<GroupBusinessException>(() => s.Open(s.Member()))).Code);
    }

    [Fact]
    public async Task ContributionsMustBeCompleteBeforeOpening()
    {
        var s = Create(complete: false);
        Assert.Equal("CYCLE_NOT_READY_FOR_SELECTION", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Open())).Code);
    }

    [Fact]
    public async Task NonMemberAndPriorWinnerCannotBid()
    {
        var s = Create(); await s.Open();
        await Assert.ThrowsAsync<GroupBusinessException>(() => s.Bid(actor: new(Guid.NewGuid(), false)));
        s.State.Selection.Participants[0].Membership.SelectForPayout(1, s.Clock.UtcNow);
        Assert.Equal("MEMBER_ALREADY_SELECTED_FOR_PAYOUT", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid())).Code);
        Assert.Empty(s.State.Bids);
    }

    [Fact]
    public async Task ReversedContributionAndInactiveMembershipCannotBid()
    {
        var s = Create(); await s.Open();
        var contribution = s.State.Selection.Contributions[0];
        // Eligibility is recomputed from authoritative obligation rows, not the cached cycle totals.
        var replacement = Contribution.Expect(contribution.GroupId, contribution.CycleId, contribution.MembershipId, 25000, contribution.DueDate, s.Clock.UtcNow);
        ((Contribution[])s.State.Selection.Contributions)[0] = replacement;
        Assert.Equal("MEMBER_NOT_ELIGIBLE_TO_BID", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid())).Code);
        typeof(GroupMembership).GetProperty(nameof(GroupMembership.Status))!.SetValue(s.State.Selection.Participants[1].Membership, MembershipStatus.Completed);
        Assert.Equal("MEMBER_NOT_ELIGIBLE_TO_BID", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid(actor: s.Member(1)))).Code);
    }

    [Fact]
    public async Task IdempotencyReturnsOriginalReceiptAfterOutbidAndClose()
    {
        var s = Create(); await s.Open(); var first = await s.Bid();
        await s.Bid(155000, "next", s.Member(1));
        Assert.Equal(first, await s.Bid());
        Assert.Equal("IDEMPOTENCY_KEY_REUSED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid(160000))).Code);
        await s.Close();
        Assert.Equal(first, await s.Bid());
        Assert.Equal(2, s.State.Bids.Count);
        Assert.Equal(2, s.State.Receipts.Count);
        var mine = await s.Service.MyBidsAsync(s.State.Selection.Group.Id, s.State.Selection.Cycle.Id, s.Member(), default);
        Assert.Single(mine); Assert.False(mine[0].IsCurrentWinningBid); Assert.Equal(155000, mine[0].CurrentHighestDiscount);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task IdempotencyKeyIsRequired(string key)
    {
        var s = Create(); await s.Open();
        Assert.Equal("IDEMPOTENCY_KEY_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid(key: key))).Code);
    }

    [Fact]
    public async Task CloseIntegratesSelectionBenefitsEligibilityAndAuditWithoutOpeningNextCycle()
    {
        var s = Create(); await s.Open(); var bid = await s.Bid(); var result = await s.Close();
        Assert.Equal("WINNER_SELECTED", result.Status);
        Assert.Equal(350000, result.Result!.WinnerPayout);
        Assert.Equal(SelectionMethod.Auction, s.State.NewSelection!.SelectionMethod);
        Assert.Equal("DHANVI_AUCTION_V1", s.State.NewSelection.AlgorithmVersion);
        Assert.Equal(s.State.NewSelection.Id, s.State.Result!.SelectionResultId);
        Assert.Equal(bid.BidId, s.State.Result.WinningBidId);
        Assert.Equal(CycleStatus.SelectionCompleted, s.State.Selection.Cycle.Status);
        Assert.True(s.State.Selection.Participants[0].Membership.HasBeenSelectedForPayout);
        Assert.Equal(1, s.State.Selection.Group.CurrentCycleNumber);
        Assert.Equal(19, SelectionPolicy.Eligible(s.State.Selection).Count);
        Assert.Equal(10, s.State.Audit.Count);
        Assert.Equal(result.Result.Id, (await s.Close()).Result!.Id);
        Assert.Equal(10, s.State.Audit.Count);
        var memberView = await s.Get(); Assert.Empty(memberView.OperationalBids); Assert.Empty(memberView.AuditHistory);
        Assert.Empty(memberView.Result!.Allocations);
    }

    [Fact]
    public async Task ZeroBidCloseHasNoSelectionAllocationsOrWinner()
    {
        var s = Create(); await s.Open(); var closed = await s.Close();
        Assert.Equal("CLOSED_NO_BIDS", closed.Status);
        Assert.Null(closed.Result); Assert.Null(s.State.NewSelection);
        Assert.Equal(CycleStatus.ReadyForSelection, s.State.Selection.Cycle.Status);
        Assert.All(s.State.Selection.Participants, p => Assert.False(p.Membership.HasBeenSelectedForPayout));
        Assert.Equal("CLOSED_NO_BIDS", (await s.Close()).Status);
        Assert.Equal("AUCTION_CLOSED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid())).Code);
    }

    [Fact]
    public async Task CycleTwoSupportsAuctionAfterOrganizerReservation()
    {
        var s = Create(reserved: true); var old = s.State.Selection; var cycle = CycleSchedule.Generate(old.Group, s.Clock.UtcNow)[1];
        // Test-only preparation represents a future explicitly opened cycle. Production does not advance cycles.
        typeof(Group).GetProperty(nameof(Group.CurrentCycleNumber))!.SetValue(old.Group, 2);
        typeof(MonthlyCycle).GetProperty(nameof(MonthlyCycle.Status))!.SetValue(cycle, CycleStatus.CollectingContributions);
        var obligations = old.Participants.Select(p => Contribution.Expect(old.Group.Id, cycle.Id, p.Membership.Id, 25000, cycle.ContributionDueDate, s.Clock.UtcNow)).ToArray();
        foreach (var c in obligations) c.Record(25000, "manual", null, "key", s.Owner.UserId, new(2030, 1, 2), s.Clock.UtcNow);
        cycle.Recalculate(500000, 20, 20, s.Clock.UtcNow); old.Participants[0].Membership.SelectForPayout(1, s.Clock.UtcNow);
        var state = new AuctionContext(old with { Cycle = cycle, Contributions = obligations });
        s.Clock.UtcNow = new(cycle.SelectionDate.ToDateTime(new(10, 0)), TimeSpan.Zero);
        var service = new AuctionService(new Store(state), s.Clock);
        Assert.Equal("OPEN", (await service.OpenAsync(old.Group.Id, cycle.Id, s.Owner, default)).Status);
        Assert.Equal("MEMBER_ALREADY_SELECTED_FOR_PAYOUT", (await Assert.ThrowsAsync<BusinessRuleException>(() => service.BidAsync(old.Group.Id, cycle.Id, s.Member(), new(150000), "key", default))).Code);
        Assert.Equal(1, (await service.BidAsync(old.Group.Id, cycle.Id, s.Member(1), new(150000), "key", default)).SequenceNumber);
    }

    [Fact]
    public void ReceiptScopeFitsSharedColumnAndSeparatesAllIdentities()
    {
        var group = Guid.NewGuid(); var cycle = Guid.NewGuid(); var actor = Guid.NewGuid();
        var scope = AuctionBidIdempotency.Scope(group, cycle, actor);
        Assert.Equal(100, scope.Length);
        Assert.NotEqual(scope, AuctionBidIdempotency.Scope(Guid.NewGuid(), cycle, actor));
        Assert.NotEqual(scope, AuctionBidIdempotency.Scope(group, Guid.NewGuid(), actor));
        Assert.NotEqual(scope, AuctionBidIdempotency.Scope(group, cycle, Guid.NewGuid()));
    }

    [Fact]
    public async Task LateUtcWindowDisplaysTheFollowingLocalCalendarDay()
    {
        var s = Create(configured: new(50000, 200000, 5000, new(23, 0), new(23, 59)));
        var details = await s.Get();
        Assert.Equal(new DateTimeOffset(2030, 1, 2, 23, 0, 0, TimeSpan.Zero), details.StartsAt);
        var local = TimeZoneInfo.ConvertTime(details.StartsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata"));
        Assert.Equal(new DateOnly(2030, 1, 3), DateOnly.FromDateTime(local.DateTime));
        Assert.Equal(new TimeOnly(4, 30), TimeOnly.FromDateTime(local.DateTime));
        s.Clock.UtcNow = details.StartsAt;
        Assert.Equal("OPEN", (await s.Open()).Status);
    }

    [Fact]
    public async Task InactiveUserAndOversizedReceiptKeyCannotBid()
    {
        var s = Create(); await s.Open();
        Assert.Equal("IDEMPOTENCY_KEY_REQUIRED", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid(key: new string('x', 129)))).Code);
        var participants = (List<SelectionParticipant>)s.State.Selection.Participants;
        participants[0] = participants[0] with { UserActive = false };
        Assert.Equal("MEMBER_NOT_ELIGIBLE_TO_BID", (await Assert.ThrowsAsync<BusinessRuleException>(() => s.Bid())).Code);
    }

    [Fact]
    public async Task MaximumDiscountDisablesFurtherBidding()
    {
        var s = Create(); await s.Open(); await s.Bid(200000);
        var details = await s.Get();
        Assert.False(details.CanBid);
        Assert.Equal("Maximum discount has been reached.", details.BidUnavailableReason);
    }
}
