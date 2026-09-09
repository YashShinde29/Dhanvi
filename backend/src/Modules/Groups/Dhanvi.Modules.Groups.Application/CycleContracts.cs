using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
namespace Dhanvi.Modules.Groups.Application;

public sealed record CycleDetails(Guid Id, Guid GroupId, int CycleNumber, SelectionMethod SelectionMethod, CycleStatus Status,
    DateOnly ContributionDueDate, DateOnly SelectionDate, DateOnly PayoutDate, string GroupTimeZone, int ExpectedMemberCount,
    decimal ExpectedContributionPerMember, decimal ExpectedPoolAmount, decimal RecordedContributionAmount, int FullyRecordedMemberCount,
    int PendingMemberCount, DateTimeOffset? StartedAt, DateTimeOffset? ContributionsCompletedAt, DateTimeOffset? ReadyForSelectionAt);
public sealed record ContributionEntryDetails(Guid Id, ContributionEntryType EntryType, decimal Amount, string Reference, string? Note, Guid RecordedByUserId, DateTimeOffset CreatedAt, Guid? ReversesEntryId);
public sealed record ContributionDetails(Guid Id, Guid GroupId, string GroupName, Guid CycleId, int CycleNumber, Guid MembershipId,
    int? SlotNumber, string? MemberName, DateOnly DueDate, string GroupTimeZone, decimal ExpectedAmount, decimal RecordedAmount,
    ContributionStatus Status, DateTimeOffset? RecordedAt, IReadOnlyList<ContributionEntryDetails> Entries);
public sealed record ContributionPage(IReadOnlyList<ContributionDetails> Items, int Page, int PageSize, int TotalCount);
public sealed record RecordContributionRequest(decimal Amount, string Reference, string? Note);
public sealed record ReverseContributionRequest(Guid EntryId, string Reason);
public sealed record ContributionOperationResult(ContributionEntryDetails Entry, bool Replayed);
public interface IGroupCycleService
{
    Task<IReadOnlyList<CycleDetails>> ActivateAsync(Guid groupId, GroupActor actor, CancellationToken ct);
    Task<IReadOnlyList<CycleDetails>> CyclesAsync(Guid groupId, GroupActor actor, bool management, CancellationToken ct);
    Task<CycleDetails> CycleAsync(Guid groupId, Guid cycleId, GroupActor actor, CancellationToken ct);
    Task<ContributionPage> MyContributionsAsync(GroupActor actor, Guid? groupId, ContributionStatus? status, int page, int pageSize, CancellationToken ct);
    Task<IReadOnlyList<ContributionDetails>> MyGroupContributionsAsync(Guid groupId, GroupActor actor, CancellationToken ct);
    Task<IReadOnlyList<ContributionDetails>> ContributionsAsync(Guid groupId, Guid cycleId, GroupActor actor, CancellationToken ct);
    Task<int> MarkOverdueAsync(Guid groupId, GroupActor actor, CancellationToken ct);
}
// Future settlement adapters can use a dedicated application contract without changing the cycle state machine.
// These methods deliberately record operational observations only, never a payment or ledger entry.
public interface IContributionRecordingService
{
    Task<ContributionOperationResult> RecordAsync(Guid groupId, Guid cycleId, Guid contributionId, GroupActor actor, string key, RecordContributionRequest request, CancellationToken ct);
    Task<ContributionOperationResult> ReverseAsync(Guid groupId, Guid cycleId, Guid contributionId, GroupActor actor, string key, ReverseContributionRequest request, CancellationToken ct);
}
