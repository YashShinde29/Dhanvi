using Dhanvi.Modules.Groups.Domain;
namespace Dhanvi.UnitTests.Groups;
public sealed class GroupTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 9, 0, 0, 0, TimeSpan.Zero);
    private static GroupConfiguration Rules(bool participates = false, bool first = false, GroupType type = GroupType.Random) => new(type, 50000, 20, participates, first, 1, 2, 2, new DateOnly(2027, 1, 1));
    private static Group Create(GroupConfiguration? rules = null) => Group.Create("Test group", "Description", GroupCreatorType.Organizer, Guid.NewGuid(), rules ?? Rules(), true, Now);
    [Theory]
    [InlineData(true, 1, false)] [InlineData(true, 2, true)] [InlineData(true, 3, true)]
    [InlineData(true, 50, true)] [InlineData(true, 51, false)]
    [InlineData(false, 19, false)] [InlineData(false, 20, true)]
    [InlineData(false, 50, true)] [InlineData(false, 51, false)]
    public void MemberPolicyBoundariesAndDerivedValues(bool development, int count, bool valid)
    {
        var policy = development ? GroupMemberPolicy.Development : GroupMemberPolicy.Production;
        // Use an exactly divisible value so capacity validation is tested independently of paise precision.
        var rules = Rules() with { MemberLimit = count, GroupValue = count * 2500m };
        Group CreateWithPolicy() => Group.Create("Policy test", "", GroupCreatorType.Organizer, Guid.NewGuid(), rules, true, Now, policy);
        if (!valid) { Error("INVALID_MEMBER_LIMIT", () => CreateWithPolicy()); return; }
        var group = CreateWithPolicy();
        group.Update(group.Name, group.Description, rules, Now, policy);
        Assert.Equal(group.GroupValue / count, group.MonthlyContribution);
        Assert.Equal(count, group.DurationMonths);
        group.Publish(true, Now, policy);
        for (var i = 0; i < count; i++) group.ApproveMember(Now);
        group.ConfirmReady(true, count, true, Now);
        group.Activate(count, true, true, false, Now, policy);
        Assert.Equal(GroupStatus.Active, group.Status);
    }

    [Fact]
    public void ProductionDefaultRevalidatesSmallGroupsAtEveryRulesBoundary()
    {
        var rules = Rules() with { MemberLimit = 2 };
        Error("INVALID_MEMBER_LIMIT", () => Create(rules));
        var group = Group.Create("Small", "", GroupCreatorType.Organizer, Guid.NewGuid(), rules, true, Now, GroupMemberPolicy.Development);
        Error("INVALID_MEMBER_LIMIT", () => group.Update(group.Name, "", rules, Now));
        Error("INVALID_MEMBER_LIMIT", () => group.Publish(true, Now));
        group.Publish(true, Now, GroupMemberPolicy.Development);
        group.ApproveMember(Now); group.ApproveMember(Now); group.ConfirmReady(true, 2, true, Now);
        Error("INVALID_MEMBER_LIMIT", () => group.Activate(2, true, true, false, Now));
    }

    [Fact]
    public void TwoMemberOrganizerParticipationLeavesOneExternalSlot()
    {
        var group = Group.Create("Small", "", GroupCreatorType.Organizer, Guid.NewGuid(),
            Rules(true, true) with { MemberLimit = 2 }, true, Now, GroupMemberPolicy.Development);
        Assert.Equal(1, group.CurrentMemberCount);
        Assert.Equal(1, group.MemberLimit - group.CurrentMemberCount);
        Assert.Equal(SelectionMethod.OrganizerReserved, group.FirstCycleSelectionMethod);
        group.Publish(true, Now, GroupMemberPolicy.Development);
        Assert.Equal(2, group.ApproveMember(Now));
        Assert.Equal(GroupStatus.FullySubscribed, group.Status);
        Error("GROUP_NOT_JOINABLE", () => group.ApproveMember(Now));
    }
    [Theory] [InlineData(GroupType.Random)] [InlineData(GroupType.Auction)]
    public void ApprovedOrganizerCreatesEitherType(GroupType type) { var g = Create(Rules(type: type)); Assert.Equal(type, g.GroupType); Assert.Equal(2500m, g.MonthlyContribution); Assert.Equal(20, g.DurationMonths); Assert.Equal(GroupStatus.Draft, g.Status); }
    [Fact] public void UnapprovedOrganizerCannotCreate() => Error("ORGANIZER_NOT_APPROVED", () => Group.Create("Test", "", GroupCreatorType.Organizer, Guid.NewGuid(), Rules(), false, Now));
    [Theory] [InlineData(19)] [InlineData(51)] public void InvalidCapacity(int count) => Error("INVALID_MEMBER_LIMIT", () => Create(Rules() with { MemberLimit = count }));
    [Theory] [InlineData(0)] [InlineData(-100)] [InlineData(50000.001)] public void InvalidAmount(decimal value) => Error("INVALID_GROUP_AMOUNT", () => Create(Rules() with { GroupValue = value }));
    [Fact] public void RejectsFractionalPaise() => Error("INVALID_CONTRIBUTION_PRECISION", () => Create(Rules() with { GroupValue = 50000.01m }));
    [Theory] [InlineData(500000, 25, 20000)] [InlineData(100000, 20, 5000)] [InlineData(50000, 20, 2500)] public void ExactContribution(decimal value, int count, decimal expected) => Assert.Equal(expected, GroupRules.Contribution(value, count));
    [Fact] public void FirstPayoutNeedsParticipation() => Error("ORGANIZER_FIRST_PAYOUT_REQUIRES_MEMBERSHIP", () => Create(Rules(first: true)));
    [Theory] [InlineData(GroupType.Random)] [InlineData(GroupType.Auction)] public void OrganizerOccupiesSlotAndReservesFirstCycle(GroupType type) { var g = Create(Rules(true, true, type)); Assert.Equal(1, g.CurrentMemberCount); Assert.Equal(19, g.MemberLimit - g.CurrentMemberCount); Assert.Equal(SelectionMethod.OrganizerReserved, g.FirstCycleSelectionMethod); }
    [Fact] public void PlatformHasNoOrganizer() { var g = Group.Create("Platform", "", GroupCreatorType.Platform, Guid.NewGuid(), Rules(), false, Now); Assert.Equal(GroupCreatorType.Platform, g.CreatorType); Error("INVALID_PLATFORM_RULES", () => Group.Create("Platform", "", GroupCreatorType.Platform, Guid.NewGuid(), Rules(true), false, Now)); }
    [Fact] public void DraftIsNotJoinable() => Error("GROUP_NOT_JOINABLE", () => Create().EnsureJoinable());
    [Fact] public void PublishRequiresStillApprovedOrganizer() => Error("ORGANIZER_NOT_APPROVED", () => Create().Publish(false, Now));
    [Fact] public void FinalApprovalFillsGroupAndStopsMoreApprovals() { var g = Create(); g.Publish(true, Now); for (var i = 1; i <= 20; i++) Assert.Equal(i, g.ApproveMember(Now)); Assert.Equal(GroupStatus.FullySubscribed, g.Status); Error("GROUP_NOT_JOINABLE", () => g.ApproveMember(Now)); }
    [Fact] public void ApprovedOrganizerMembershipLocksDraftRules() { var g = Create(Rules(true)); Error("GROUP_RULES_LOCKED", () => g.Update(g.Name, g.Description, Rules(true) with { GroupValue = 100000 }, Now)); }
    [Fact] public void PublishedRulesCannotBeEdited() { var g = Create(); g.Publish(true, Now); Error("GROUP_NOT_EDITABLE", () => g.Update(g.Name, g.Description, Rules() with { GroupValue = 100000 }, Now)); }
    [Fact] public void AcceptanceRecordsSnapshotHashAndVersion() { var g = Create(); var version = g.Publish(true, Now); var member = GroupMembership.Apply(g.Id, Guid.NewGuid(), Now); member.Approve(1, Now); var acceptance = member.Accept(version, Now); Assert.Equal(version.Id, acceptance.GroupRuleVersionId); Assert.Equal(version.RulesHash, acceptance.RulesHash); Assert.Equal(Now, member.TermsAcceptedAt); Assert.False(member.HasReceivedPayout); Error("TERMS_ALREADY_ACCEPTED", () => member.Accept(version, Now)); }
    [Fact] public void PendingMemberCannotAccept() { var g = Create(); var version = g.Publish(true, Now); Error("MEMBERSHIP_NOT_APPROVED", () => GroupMembership.Apply(g.Id, Guid.NewGuid(), Now).Accept(version, Now)); }
    [Fact] public void ReadinessRequiresFullCapacity() { var g = Create(); g.Publish(true, Now); Error("GROUP_NOT_FULLY_SUBSCRIBED", () => g.ConfirmReady(true, 0, true, Now)); }
    [Fact] public void ReadinessRequiresEveryAcceptanceAndThenSucceeds() { var g = Create(); g.Publish(true, Now); for (var i = 0; i < 20; i++) g.ApproveMember(Now); Error("CURRENT_RULE_VERSION_REQUIRED", () => g.ConfirmReady(false, 20, true, Now)); g.ConfirmReady(true, 20, true, Now); Assert.Equal(GroupStatus.ReadyToStart, g.Status); }
    [Theory] [InlineData(true)] [InlineData(false)] public void StoppedGroupsRejectApplications(bool cancel) { var g = Create(); g.Publish(true, Now); g.Stop(cancel, "Review needed", Now); Error("GROUP_NOT_JOINABLE", g.EnsureJoinable); }
    [Fact] public void ReviewIsOneTime() { var m = GroupMembership.Apply(Guid.NewGuid(), Guid.NewGuid(), Now); m.Approve(1, Now); Error("APPLICATION_ALREADY_REVIEWED", () => m.Reject("No", Now)); }
    [Fact] public void InvalidAuctionRulesFail() => Error("INVALID_AUCTION_RULES", () => Create(Rules(type: GroupType.Auction) with { AuctionRules = new(0, 50000, 100, new(10, 0), new(11, 0)) }));
    private static void Error(string code, Action action) => Assert.Equal(code, Assert.Throws<GroupBusinessException>(action).Code);
}
