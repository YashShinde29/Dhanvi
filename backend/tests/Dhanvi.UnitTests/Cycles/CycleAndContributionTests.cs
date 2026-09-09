using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
namespace Dhanvi.UnitTests.Cycles;

public sealed class CycleAndContributionTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2026, 9, 1);
    private static readonly DateOnly Due = new(2026, 10, 1);
    private static Group Ready(int count = 20, GroupType type = GroupType.Random, bool reserved = false, DateOnly? start = null)
    {
        var group = Group.Create("Cycles test", "", GroupCreatorType.Organizer, Guid.NewGuid(), new(type, 50000, count, reserved, reserved, 1, 2, 2, start ?? Due), true, Now);
        group.Publish(true, Now); for (var i = group.CurrentMemberCount; i < count; i++) group.ApproveMember(Now);
        group.ConfirmReady(true, count, true, Now); return group;
    }
    private static Contribution Obligation() => Contribution.Expect(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 2500, Due, Now);
    [Theory] [InlineData(20)] [InlineData(50)]
    public void ActivationProducesFullSequentialSchedule(int members)
    {
        var g = Ready(members); g.Activate(members, true, true, false, Now); var cycles = CycleSchedule.Generate(g, Now);
        Assert.Equal(GroupStatus.Active, g.Status); Assert.Equal(Now, g.ActivatedAt); Assert.Equal(1, g.CurrentCycleNumber);
        Assert.Equal(members, cycles.Count); Assert.Equal(Enumerable.Range(1, members), cycles.Select(c => c.CycleNumber));
        Assert.All(cycles, c => { Assert.Equal(g.MonthlyContribution, c.ExpectedContributionPerMember); Assert.Equal(g.GroupValue, c.ExpectedPoolAmount); });
        Assert.Equal(CycleStatus.CollectingContributions, cycles[0].Status); Assert.All(cycles.Skip(1), c => Assert.Equal(CycleStatus.Upcoming, c.Status));
    }
    [Theory] [InlineData(GroupType.Random, false, SelectionMethod.Random)] [InlineData(GroupType.Auction, false, SelectionMethod.Auction)] [InlineData(GroupType.Random, true, SelectionMethod.OrganizerReserved)] [InlineData(GroupType.Auction, true, SelectionMethod.OrganizerReserved)]
    public void SelectionMethodsAreOnlyConfiguration(GroupType type, bool reserved, SelectionMethod first)
    {
        var cycles = CycleSchedule.Generate(Ready(type: type, reserved: reserved), Now); Assert.Equal(first, cycles[0].SelectionMethod);
        Assert.All(cycles.Skip(1), c => Assert.Equal(type == GroupType.Random ? SelectionMethod.Random : SelectionMethod.Auction, c.SelectionMethod));
    }
    [Fact] public void StartAfterDueDayRollsFirstDueForward() { var cycles = CycleSchedule.Generate(Ready(start: new(2026, 12, 15)), Now); Assert.Equal(new DateOnly(2027, 1, 1), cycles[0].ContributionDueDate); Assert.Equal(new DateOnly(2027, 2, 1), cycles[1].ContributionDueDate); }
    [Fact] public void FebruaryAndYearBoundaryDatesAreSafe() { var cycles = CycleSchedule.Generate(Ready(start: new(2027, 12, 1)), Now); Assert.Equal(new DateOnly(2028, 2, 1), cycles[2].ContributionDueDate); }
    [Theory] [InlineData(18, 29, 1)] [InlineData(18, 30, 2)] public void BusinessDateUsesIndiaMidnight(int hour, int minute, int day) => Assert.Equal(new DateOnly(2026, 9, day), BusinessCalendar.Today(new DateTimeOffset(2026, 9, 1, hour, minute, 0, TimeSpan.Zero)));
    [Fact] public void ActivationRejectsRecruitingAndFullySubscribed()
    {
        var g = Group.Create("Test", "", GroupCreatorType.Platform, Guid.NewGuid(), new(GroupType.Random, 50000, 20, false, false, 1, 2, 2, Due), false, Now); g.Publish(false, Now);
        Assert.Throws<GroupBusinessException>(() => g.Activate(20, true, false, false, Now));
        for (var i = 0; i < 20; i++) g.ApproveMember(Now); Assert.Throws<GroupBusinessException>(() => g.Activate(20, true, false, false, Now));
    }
    [Fact] public void ActivationRevalidatesTermsAndOrganizer() { var g = Ready(); Assert.Throws<GroupBusinessException>(() => g.Activate(20, false, true, false, Now)); Assert.Throws<GroupBusinessException>(() => g.Activate(20, true, false, false, Now)); Assert.Throws<GroupBusinessException>(() => g.Activate(19, true, true, false, Now)); }
    [Fact] public void ExistingCyclesAndStaleDateBlockActivation() { Assert.Throws<GroupBusinessException>(() => Ready().Activate(20, true, true, true, Now)); Assert.Throws<GroupBusinessException>(() => Ready().Activate(20, true, true, false, Now.AddMonths(2))); }
    [Fact] public void BadExpectedPoolIsRejected() => Assert.Throws<BusinessRuleException>(() => MonthlyCycle.Create(Guid.NewGuid(), 1, SelectionMethod.Random, Due, Due, Due, 20, 2500, 49999, Now));
    [Fact] public void ActiveRulesAndMembershipRemainLocked() { var g = Ready(); g.Activate(20, true, true, false, Now); Assert.Throws<GroupBusinessException>(() => g.Update(g.Name, "", g.Rules with { GroupValue = 100000 }, Now)); Assert.Throws<GroupBusinessException>(g.EnsureMemberRemovalAllowed); }
    [Fact] public void ActiveSuspensionPreservesActivationAndCannotBeCancelled() { var g = Ready(); g.Activate(20, true, true, false, Now); g.Stop(false, "Review", Now); Assert.Equal(GroupStatus.Suspended, g.Status); Assert.NotNull(g.ActivatedAt); Assert.Throws<GroupBusinessException>(() => g.Stop(true, "Cancel", Now)); }
    [Fact] public void FullRecordingMarksRecorded() { var c = Obligation(); var entry = c.Record(2500, "manual", null, "key", Guid.NewGuid(), Today, Now); Assert.Equal(ContributionStatus.Recorded, c.Status); Assert.Equal(2500, c.RecordedAmount); Assert.Equal(ContributionEntryType.Record, entry.EntryType); }
    [Fact] public void PartialThenRemainderMatchesExpected() { var c = Obligation(); c.Record(500, "first", null, "k1", Guid.NewGuid(), Today, Now); Assert.Equal(ContributionStatus.Partial, c.Status); c.Record(2000, "second", null, "k2", Guid.NewGuid(), Today, Now); Assert.Equal(ContributionStatus.Recorded, c.Status); }
    [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(2501)] [InlineData(10.001)] public void InvalidRecordAmountRejected(decimal amount) => Assert.Throws<BusinessRuleException>(() => Obligation().Record(amount, "ref", null, "key", Guid.NewGuid(), Today, Now));
    [Fact] public void OverRecordingRejected() { var c = Obligation(); c.Record(2500, "first", null, "k1", Guid.NewGuid(), Today, Now); Assert.Throws<BusinessRuleException>(() => c.Record(1, "second", null, "k2", Guid.NewGuid(), Today, Now)); }
    [Fact] public void ReversalRetainsOriginalEntryAndRestoresShortfall() { var c = Obligation(); var first = c.Record(2500, "first", null, "k1", Guid.NewGuid(), Today, Now); var reverse = c.Reverse(first, "Incorrect record", "k2", Guid.NewGuid(), false, Today, Now); Assert.Equal(0, c.RecordedAmount); Assert.Equal(ContributionStatus.Reversed, c.Status); Assert.Equal(first.Id, reverse.ReversesEntryId); Assert.Equal(2500, first.Amount); Assert.Equal(ContributionEntryType.Record, first.EntryType); }
    [Fact] public void CannotReverseAnEntryTwice() { var c = Obligation(); var entry = c.Record(2500, "ref", null, "key", Guid.NewGuid(), Today, Now); Assert.Throws<BusinessRuleException>(() => c.Reverse(entry, "reason", "key2", Guid.NewGuid(), true, Today, Now)); }
    [Fact] public void PartialReversalLeavesCorrectPartialAmount() { var c = Obligation(); var first = c.Record(500, "a", null, "a", Guid.NewGuid(), Today, Now); c.Record(500, "b", null, "b", Guid.NewGuid(), Today, Now); c.Reverse(first, "Correction", "c", Guid.NewGuid(), false, Today, Now); Assert.Equal(500, c.RecordedAmount); Assert.Equal(ContributionStatus.Partial, c.Status); }
    [Fact] public void ShortfallBlocksReadinessAndFinalRecordSetsBothTimestamps() { var c = CycleSchedule.Generate(Ready(), Now)[0]; Assert.False(c.Recalculate(47500, 19, 20, Now)); Assert.Equal(CycleStatus.CollectingContributions, c.Status); Assert.True(c.Recalculate(50000, 20, 20, Now)); Assert.Equal(CycleStatus.ReadyForSelection, c.Status); Assert.Equal(Now, c.ContributionsCompletedAt); Assert.Equal(Now, c.ReadyForSelectionAt); Assert.Throws<BusinessRuleException>(c.EnsureRecordingOpen); c.Recalculate(47500, 19, 20, Now); Assert.Equal(CycleStatus.CollectingContributions, c.Status); Assert.Null(c.ReadyForSelectionAt); }
    [Fact] public void FutureCyclesCannotRecordOrReverse() { var c = CycleSchedule.Generate(Ready(), Now)[1]; Assert.Throws<BusinessRuleException>(c.EnsureRecordingOpen); Assert.Throws<BusinessRuleException>(c.EnsureReversalAllowed); }
    [Fact] public void OverdueRequiresDateAfterDueAndShortfall() { var c = Obligation(); Assert.False(c.MarkOverdue(Due, Now)); Assert.True(c.MarkOverdue(Due.AddDays(1), Now)); Assert.Equal(ContributionStatus.Overdue, c.Status); Assert.False(c.MarkOverdue(Due.AddDays(2), Now)); }
    [Fact] public void FullyRecordedNeverBecomesOverdue() { var c = Obligation(); c.Record(2500, "ref", null, "key", Guid.NewGuid(), Today, Now); Assert.False(c.MarkOverdue(Due.AddDays(1), Now)); Assert.Equal(ContributionStatus.Recorded, c.Status); }
    [Fact] public void IdempotencyReceiptChecksPayload() { var r = new IdempotencyRecord("group", "key", "hash", Guid.NewGuid(), Now); r.ValidateReplay("hash"); Assert.Throws<BusinessRuleException>(() => r.ValidateReplay("changed")); }
}
