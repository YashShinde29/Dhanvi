using Dhanvi.Modules.Groups.Domain;
namespace Dhanvi.Modules.Groups.Application;

public sealed record SaveGroupRequest(string Name, string Description, GroupType GroupType, decimal GroupValue, int MemberLimit,
    bool OrganizerParticipates, bool OrganizerFirstPayout, int ContributionDueDay, int SelectionDay, int PayoutDay, DateOnly StartDate,
    AuctionGroupRules? AuctionRules = null, RandomGroupRules? RandomRules = null)
{
    public GroupConfiguration Configuration() => new(GroupType, GroupValue, MemberLimit, OrganizerParticipates, OrganizerFirstPayout, ContributionDueDay, SelectionDay, PayoutDay, StartDate, AuctionRules, RandomRules);
}
public sealed record GroupActor(Guid UserId, bool IsAdmin);
public sealed record GroupFilter(GroupType? GroupType = null, GroupCreatorType? CreatorType = null, GroupStatus? Status = null,
    decimal? MinGroupValue = null, decimal? MaxGroupValue = null, int? MemberLimit = null, Guid? OrganizerId = null,
    int Page = 1, int PageSize = 20, string? Sort = null, string? Search = null, string? Section = null);
public sealed record GroupPage(IReadOnlyList<GroupDetails> Items, int Page, int PageSize, int TotalCount);
public sealed record PublicOrganizer(string Name, bool Verified, string Status, DateTimeOffset MemberSince);
public sealed record OrganizerContact(string Name, string? Phone, string Email);
public sealed record MemberDetails(Guid Id, Guid UserId, string Name, string? Email, int? SlotNumber, MembershipStatus Status,
    DateTimeOffset AppliedAt, DateTimeOffset? ApprovedAt, Guid? TermsVersionId, DateTimeOffset? TermsAcceptedAt, string? RejectedReason, bool HasBeenSelectedForPayout, int? PayoutCycleNumber);
public sealed record PublishedGroupRules(Guid Id, int VersionNumber, string RulesSnapshot, string RulesHash);
public sealed record GroupDetails(Guid Id, string Name, string Description, GroupType GroupType, GroupCreatorType CreatorType,
    decimal GroupValue, int MemberLimit, int CurrentMemberCount, int AvailableSlots, decimal MonthlyContribution, int DurationMonths,
    bool OrganizerParticipates, bool OrganizerFirstPayout, SelectionMethod FirstCycleSelectionMethod, int ContributionDueDay,
    int SelectionDay, int PayoutDay, DateOnly StartDate, GroupStatus Status, int RulesVersion, bool RulesLocked,
    PublicOrganizer? Organizer, PublishedGroupRules? CurrentRules, MemberDetails? MyMembership, int PendingApplications,
    AuctionGroupRules? AuctionRules, RandomGroupRules? RandomRules, string? StatusReason, string GroupTimeZone, DateTimeOffset? ActivatedAt, int? CurrentCycleNumber);
public interface IGroupService
{
    Task<GroupDetails> CreateAsync(GroupActor actor, GroupCreatorType creator, SaveGroupRequest request, CancellationToken ct);
    Task<GroupDetails> UpdateAsync(Guid id, GroupActor actor, SaveGroupRequest request, CancellationToken ct);
    Task<GroupPage> BrowseAsync(GroupFilter filter, GroupActor? actor, string scope, CancellationToken ct);
    Task<GroupDetails> DetailsAsync(Guid id, GroupActor? actor, bool management, CancellationToken ct);
    Task ExecuteAsync(Guid id, GroupActor actor, string operation, Guid? membershipId, Guid? termsVersionId, string? rulesHash, string? reason, CancellationToken ct);
    Task<IReadOnlyList<MemberDetails>> MembersAsync(Guid id, GroupActor actor, CancellationToken ct);
    Task<OrganizerContact> ContactAsync(Guid id, GroupActor actor, CancellationToken ct);
}
