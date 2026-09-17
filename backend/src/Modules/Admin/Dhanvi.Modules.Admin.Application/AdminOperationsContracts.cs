namespace Dhanvi.Modules.Admin.Application;

// Read models for the Admin Control Center. Every value is a projection of existing module state; nothing here
// decides business outcomes. Status strings use the API's SNAKE_CASE_UPPER enum spelling so the frontend catalog applies.

/// <summary>One monthly cycle as the admin sees it: schedule, settlement progress, selection and auction state.</summary>
public sealed record AdminCycleSnapshot(Guid Id, int CycleNumber, string Status, string SelectionMethod, string CollectionMode,
    DateOnly ContributionDueDate, DateOnly SelectionDate, DateOnly PayoutDate,
    int ExpectedMemberCount, int SettledMemberCount, int OutstandingMemberCount, decimal ExpectedPoolAmount, decimal SettledAmount,
    int ManualRecordedMemberCount, decimal ManualRecordedAmount,
    DateTimeOffset? StartedAt, DateTimeOffset? ReadyForSelectionAt, DateTimeOffset? SelectionCompletedAt, DateTimeOffset? CompletedAt,
    Guid? SelectionResultId, string? WinnerName, int? WinnerSlotNumber, string? AuctionStatus, DateTimeOffset? AuctionStartsAt, DateTimeOffset? AuctionEndsAt, int AuctionBidCount);

public sealed record AdminPaymentCounts(int Captured, int Pending, int Failed, int ReconciliationRequired, int Refunded)
{
    public static readonly AdminPaymentCounts Empty = new(0, 0, 0, 0, 0);
}
public sealed record AdminPayoutCounts(int PendingBeneficiary, int ApprovalRequired, int Approved, int Processing, int Succeeded, int Failed, int ReconciliationRequired, int Cancelled)
{
    public static readonly AdminPayoutCounts Empty = new(0, 0, 0, 0, 0, 0, 0, 0);
}

/// <summary>One row of the admin group management table.</summary>
public sealed record AdminGroupOperationsRow(Guid Id, string Name, string CreatorType, string GroupType, string CollectionMode,
    Guid CreatedByUserId, string? OrganizerName, string? OrganizerStatus,
    decimal GroupValue, decimal MonthlyContribution, int MemberLimit, int CurrentMemberCount, int ActiveMemberCount, int PendingApplications, int TermsPendingCount,
    string Status, string? StatusReason, DateOnly StartDate, DateTimeOffset CreatedAt, DateTimeOffset? ActivatedAt, int DurationMonths, int? CurrentCycleNumber,
    AdminCycleSnapshot? CurrentCycle, AdminPaymentCounts Payments, AdminPayoutCounts Payouts, DateTimeOffset? LastActivityAt);

public sealed record AdminGroupOperationsPage(IReadOnlyList<AdminGroupOperationsRow> Items, int Page, int PageSize, int TotalCount);

public sealed record AdminGroupOperationsFilter(string? Status = null, string? CreatorType = null, string? GroupType = null, string? CycleStatus = null,
    Guid? OrganizerId = null, string? Search = null, int Page = 1, int PageSize = 25, string? Sort = null);

public sealed record AdminOutstandingContribution(Guid ContributionId, Guid MembershipId, string MemberName, int? SlotNumber, decimal ExpectedAmount,
    decimal SettledAmount, decimal ManualRecordedAmount, string Status, string FinancialStatus, DateOnly DueDate);

public sealed record AdminPayoutSnapshot(Guid Id, Guid CycleId, int CycleNumber, string PayoutType, Guid? MembershipId, string MemberName, decimal Amount, string Status,
    bool HasBeneficiary, DateTimeOffset CreatedAt, DateTimeOffset? ApprovedAt, DateTimeOffset? SettledAt);

public sealed record AdminPaymentSnapshot(Guid Id, Guid CycleId, int CycleNumber, string MemberName, decimal Amount, string Status,
    string ReconciliationStatus, string? ReconciliationMessage, DateTimeOffset CreatedAt);

/// <summary>Something that stops or slows a group and who must resolve it (USER, ORGANIZER, ADMIN, FINANCE, SYSTEM).</summary>
public sealed record AdminGroupIssue(string Kind, string Title, string Detail, string ResponsibleRole, DateTimeOffset? Since, string? ReferenceType, Guid? ReferenceId);

public sealed record AdminActivityEntry(Guid Id, DateTimeOffset At, string Source, string Action, string? ActorName, string? Message, Guid? SubjectId, Guid? CycleId);

public sealed record AdminGroupOperationsSummary(AdminGroupOperationsRow Group, IReadOnlyList<AdminCycleSnapshot> Cycles,
    IReadOnlyList<AdminOutstandingContribution> OutstandingContributions, IReadOnlyList<AdminPayoutSnapshot> Payouts,
    IReadOnlyList<AdminPaymentSnapshot> PaymentIssues, IReadOnlyList<AdminGroupIssue> Issues, IReadOnlyList<AdminActivityEntry> Activity);

/// <summary>A count plus the age of its oldest waiting item, for "Requires attention" cards.</summary>
public sealed record AdminAttentionBucket(int Count, DateTimeOffset? OldestSince)
{
    public static readonly AdminAttentionBucket Empty = new(0, null);
}

public sealed record AdminGroupOverview(int Total, int Draft, int Recruiting, int FullySubscribed, int ReadyToStart, int Active, int Completed, int Suspended, int Cancelled,
    int ActiveMembers,
    AdminAttentionBucket PlatformReadyToActivate, AdminAttentionBucket PlatformReadyToConfirm, AdminAttentionBucket PlatformApplicationsPending,
    AdminAttentionBucket OrganizerGroupsAwaitingOrganizer, AdminAttentionBucket SuspendedGroups,
    int CyclesCollecting, AdminAttentionBucket CyclesOverdueCollecting, AdminAttentionBucket PlatformCyclesReadyForSelection, AdminAttentionBucket OrganizerCyclesReadyForSelection,
    AdminAttentionBucket CyclesSelectionCompleted, int CyclesPayoutPending, AdminAttentionBucket AuctionsOpen, AdminAttentionBucket AuctionsClosedNoBids);

public sealed record AdminPaymentOverview(AdminPaymentCounts Counts, AdminAttentionBucket ReconciliationRequired, AdminAttentionBucket Pending);
public sealed record AdminPayoutOverview(AdminPayoutCounts Counts, AdminAttentionBucket ApprovalRequired, AdminAttentionBucket ReadyToExecute, AdminAttentionBucket Failed,
    AdminAttentionBucket ReconciliationRequired, AdminAttentionBucket PendingBeneficiary, AdminAttentionBucket Processing);
public sealed record AdminOrganizerOverview(AdminAttentionBucket ApplicationsPending, int UnderReview, int Approved, int Suspended);

public sealed record AdminOperationsOverview(AdminGroupOverview Groups, AdminPaymentOverview Payments, AdminPayoutOverview Payouts, AdminOrganizerOverview Organizers, DateTimeOffset GeneratedAt);

/// <summary>Composes module read models into the admin operations views. Registered by the Admin module.</summary>
public interface IAdminOperationsService
{
    Task<AdminOperationsOverview> OverviewAsync(CancellationToken ct);
    Task<AdminGroupOperationsPage> GroupsAsync(AdminGroupOperationsFilter filter, CancellationToken ct);
    Task<AdminGroupOperationsSummary> GroupAsync(Guid groupId, CancellationToken ct);
}

// Each business module implements its reader inside its own Infrastructure (it owns the DbContext) and registers it.
// The Admin module only composes; it never opens another module's tables.

public interface IGroupOperationsReader
{
    Task<AdminGroupOperationsPage> ListAsync(AdminGroupOperationsFilter filter, CancellationToken ct);
    Task<AdminGroupOperationsRow?> GroupAsync(Guid groupId, CancellationToken ct);
    Task<IReadOnlyList<AdminCycleSnapshot>> CyclesAsync(Guid groupId, CancellationToken ct);
    Task<IReadOnlyList<AdminOutstandingContribution>> OutstandingContributionsAsync(Guid groupId, Guid cycleId, CancellationToken ct);
    Task<IReadOnlyList<AdminActivityEntry>> ActivityAsync(Guid groupId, int limit, CancellationToken ct);
    Task<AdminGroupOverview> OverviewAsync(CancellationToken ct);
}
public interface IPaymentOperationsReader
{
    Task<IReadOnlyDictionary<Guid, AdminPaymentCounts>> CountsByGroupAsync(IReadOnlyCollection<Guid> groupIds, CancellationToken ct);
    Task<IReadOnlyList<AdminPaymentSnapshot>> IssuesAsync(Guid groupId, CancellationToken ct);
    Task<AdminPaymentOverview> OverviewAsync(CancellationToken ct);
}
public interface IPayoutOperationsReader
{
    Task<IReadOnlyDictionary<Guid, AdminPayoutCounts>> CountsByGroupAsync(IReadOnlyCollection<Guid> groupIds, CancellationToken ct);
    Task<IReadOnlyList<AdminPayoutSnapshot>> GroupPayoutsAsync(Guid groupId, CancellationToken ct);
    Task<IReadOnlyList<AdminActivityEntry>> ActivityAsync(Guid groupId, int limit, CancellationToken ct);
    Task<AdminPayoutOverview> OverviewAsync(CancellationToken ct);
}
public interface IOrganizerOperationsReader
{
    Task<AdminOrganizerOverview> OverviewAsync(CancellationToken ct);
}
