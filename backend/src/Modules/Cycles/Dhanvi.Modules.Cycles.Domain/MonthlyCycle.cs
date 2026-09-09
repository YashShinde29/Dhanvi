using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;

namespace Dhanvi.Modules.Cycles.Domain;

public enum CycleStatus { Upcoming, CollectingContributions, ContributionsComplete, ReadyForSelection, SelectionCompleted, PayoutPending, PayoutCompleted, Completed, Suspended }

public sealed class MonthlyCycle
{
    private MonthlyCycle() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public int CycleNumber { get; private set; }
    public SelectionMethod SelectionMethod { get; private set; }
    public DateOnly ContributionDueDate { get; private set; }
    public DateOnly SelectionDate { get; private set; }
    public DateOnly PayoutDate { get; private set; }
    public int ExpectedMemberCount { get; private set; }
    public decimal ExpectedContributionPerMember { get; private set; }
    public decimal ExpectedPoolAmount { get; private set; }
    public decimal RecordedContributionAmount { get; private set; }
    public int FullyRecordedMemberCount { get; private set; }
    public CycleStatus Status { get; private set; } = CycleStatus.Upcoming;
    public DateTimeOffset? StartedAt { get; private set; }
    public DateTimeOffset? ContributionsCompletedAt { get; private set; }
    public DateTimeOffset? ReadyForSelectionAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public int Version { get; private set; }

    public static MonthlyCycle Create(Guid groupId, int number, SelectionMethod method, DateOnly dueDate, DateOnly selectionDate, DateOnly payoutDate, int members, decimal contribution, decimal pool, DateTimeOffset now)
    {
        BusinessRuleException.Require(number >= 1 && members > 0 && number <= members && contribution > 0 && decimal.Round(contribution, 2) == contribution && contribution * members == pool,
            "INVALID_EXPECTED_POOL", "Expected contribution times member count must exactly equal group value.");
        BusinessRuleException.Require(dueDate <= selectionDate && selectionDate <= payoutDate, "INVALID_CYCLE_DATES", "Cycle dates must follow contribution, selection, payout order.");
        var cycle = new MonthlyCycle { GroupId = groupId, CycleNumber = number, SelectionMethod = method, ContributionDueDate = dueDate, SelectionDate = selectionDate, PayoutDate = payoutDate,
            ExpectedMemberCount = members, ExpectedContributionPerMember = contribution, ExpectedPoolAmount = pool, CreatedAt = now, UpdatedAt = now };
        if (number == 1) { cycle.Status = CycleStatus.CollectingContributions; cycle.StartedAt = now; }
        return cycle;
    }
    public void EnsureRecordingOpen() => BusinessRuleException.Require(Status == CycleStatus.CollectingContributions, "CYCLE_NOT_COLLECTING", "Only the collecting cycle accepts new contribution records.");
    public void EnsureReversalAllowed() => BusinessRuleException.Require(Status is CycleStatus.CollectingContributions or CycleStatus.ContributionsComplete or CycleStatus.ReadyForSelection,
        "CYCLE_REVERSAL_NOT_ALLOWED", "Reversal is allowed only before selection execution.");

    // The caller supplies totals from every obligation while holding the group's database lock.
    public bool Recalculate(decimal recorded, int fullyRecorded, int obligationCount, DateTimeOffset now)
    {
        EnsureReversalAllowed();
        BusinessRuleException.Require(obligationCount == ExpectedMemberCount && recorded >= 0 && recorded <= ExpectedPoolAmount && fullyRecorded >= 0 && fullyRecorded <= ExpectedMemberCount,
            "INVALID_CYCLE_TOTALS", "Cycle totals do not match its expected obligations.");
        RecordedContributionAmount = recorded; FullyRecordedMemberCount = fullyRecorded; UpdatedAt = now; Version++;
        var complete = fullyRecorded == ExpectedMemberCount && recorded == ExpectedPoolAmount;
        var becameReady = complete && Status != CycleStatus.ReadyForSelection;
        if (complete)
        {
            if (becameReady)
            {
                Status = CycleStatus.ContributionsComplete; ContributionsCompletedAt = now;
                Status = CycleStatus.ReadyForSelection; ReadyForSelectionAt = now;
            }
        }
        else
        {
            // A reversal reopens this same cycle. Historical readiness events remain in audit history.
            Status = CycleStatus.CollectingContributions; ContributionsCompletedAt = null; ReadyForSelectionAt = null;
        }
        return becameReady;
    }
}

public static class CycleSchedule
{
    public static IReadOnlyList<MonthlyCycle> Generate(Group group, DateTimeOffset now)
    {
        var r = group.Rules;
        BusinessRuleException.Require(group.DurationMonths == group.MemberLimit && group.MonthlyContribution * group.MemberLimit == group.GroupValue,
            "INVALID_EXPECTED_POOL", "Group duration and expected pool are inconsistent.");
        BusinessRuleException.Require(r.ContributionDueDay >= 1 && r.ContributionDueDay <= r.SelectionDay && r.SelectionDay <= r.PayoutDay && r.PayoutDay <= 28 && r.StartDate.Year <= 9995,
            "INVALID_CYCLE_DATES", "Scheduling days must be ordered between 1 and 28 and the full schedule must fit the calendar.");
        // First due date is on/after StartDate. If this month's due day has passed, use next month.
        var first = new DateOnly(r.StartDate.Year, r.StartDate.Month, r.ContributionDueDay);
        if (first < r.StartDate) first = first.AddMonths(1);
        var cycles = new List<MonthlyCycle>(group.DurationMonths);
        for (var number = 1; number <= group.DurationMonths; number++)
        {
            var due = first.AddMonths(number - 1);
            var method = number == 1 ? group.FirstCycleSelectionMethod : r.GroupType == GroupType.Random ? SelectionMethod.Random : SelectionMethod.Auction;
            cycles.Add(MonthlyCycle.Create(group.Id, number, method, due, new(due.Year, due.Month, r.SelectionDay), new(due.Year, due.Month, r.PayoutDay), group.MemberLimit, group.MonthlyContribution, group.GroupValue, now));
        }
        return cycles;
    }
}
