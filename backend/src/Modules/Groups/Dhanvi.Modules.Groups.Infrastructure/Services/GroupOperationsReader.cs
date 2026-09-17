using System.Text.Json;
using Dhanvi.Modules.Admin.Application;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

/// <summary>
/// Admin read model over the Groups schema (groups, memberships, cycles, contributions, selections, auctions, audit events).
/// Pure projection: every number is read from persisted state and nothing here changes it. The list loads one page of
/// groups and then aggregates memberships/cycles/auctions/selections for that page in a fixed number of set-based queries.
/// </summary>
internal sealed class GroupOperationsReader(GroupsDbContext db, IGroupUserDirectory users, IOrganizerStatusReader organizers, IDateTimeProvider clock) : IGroupOperationsReader
{
    private static readonly JsonNamingPolicy Upper = JsonNamingPolicy.SnakeCaseUpper;
    private static string Name<T>(T value) where T : struct, Enum => Upper.ConvertName(value.ToString());
    private static T? Parse<T>(string? value) where T : struct, Enum =>
        string.IsNullOrWhiteSpace(value) ? null : Enum.TryParse<T>(value.Replace("_", "", StringComparison.Ordinal), true, out var parsed) && Enum.IsDefined(parsed) ? parsed
            : throw new RequestValidationException(new Dictionary<string, string[]> { [typeof(T).Name] = [$"Invalid {typeof(T).Name} filter."] });

    public async Task<AdminGroupOperationsPage> ListAsync(AdminGroupOperationsFilter filter, CancellationToken ct)
    {
        var q = db.Groups.AsNoTracking();
        if (Parse<GroupStatus>(filter.Status) is { } status) q = q.Where(g => g.Status == status);
        if (Parse<GroupCreatorType>(filter.CreatorType) is { } creator) q = q.Where(g => g.CreatorType == creator);
        if (Parse<GroupType>(filter.GroupType) is { } type) q = q.Where(g => g.GroupType == type);
        if (filter.OrganizerId is { } organizer) q = q.Where(g => g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == organizer);
        if (!string.IsNullOrWhiteSpace(filter.Search)) q = q.Where(g => EF.Functions.ILike(g.Name, $"%{filter.Search.Trim()}%"));
        if (Parse<CycleStatus>(filter.CycleStatus) is { } cycleStatus)
            q = q.Where(g => g.CurrentCycleNumber != null && db.MonthlyCycles.Any(c => c.GroupId == g.Id && c.CycleNumber == g.CurrentCycleNumber && c.Status == cycleStatus));
        var total = await q.CountAsync(ct);
        var page = Math.Clamp(filter.Page, 1, 100000); var size = Math.Clamp(filter.PageSize, 1, 100);
        q = filter.Sort switch
        {
            "name" => q.OrderBy(g => g.Name).ThenBy(g => g.Id),
            "value_desc" => q.OrderByDescending(g => g.GroupValue).ThenBy(g => g.Id),
            _ => q.OrderByDescending(g => g.UpdatedAt).ThenBy(g => g.Id),
        };
        var groups = await q.Skip((page - 1) * size).Take(size).ToListAsync(ct);
        return new(await Rows(groups, ct), page, size, total);
    }

    public async Task<AdminGroupOperationsRow?> GroupAsync(Guid groupId, CancellationToken ct)
    {
        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.Id == groupId, ct);
        return group is null ? null : (await Rows([group], ct))[0];
    }

    private async Task<IReadOnlyList<AdminGroupOperationsRow>> Rows(List<Group> groups, CancellationToken ct)
    {
        if (groups.Count == 0) return [];
        var ids = groups.Select(g => g.Id).ToArray();
        var memberCounts = await db.Memberships.AsNoTracking().Where(m => ids.Contains(m.GroupId))
            .GroupBy(m => new { m.GroupId, m.Status }).Select(x => new { x.Key.GroupId, x.Key.Status, Count = x.Count() }).ToListAsync(ct);
        var currentRules = await db.RuleVersions.AsNoTracking().Where(v => ids.Contains(v.GroupId))
            .Where(v => db.Groups.Any(g => g.Id == v.GroupId && g.RulesVersion == v.VersionNumber)).Select(v => new { v.GroupId, v.Id }).ToListAsync(ct);
        var currentRuleIds = currentRules.ToDictionary(x => x.GroupId, x => x.Id);
        var termsPending = await db.Memberships.AsNoTracking().Where(m => ids.Contains(m.GroupId) && m.Status == MembershipStatus.Approved)
            .Select(m => new { m.GroupId, m.TermsVersionId, m.TermsAcceptedAt }).ToListAsync(ct);
        var lastActivity = await db.AuditEvents.AsNoTracking().Where(e => ids.Contains(e.GroupId))
            .GroupBy(e => e.GroupId).Select(x => new { GroupId = x.Key, At = x.Max(e => e.CreatedAt) }).ToDictionaryAsync(x => x.GroupId, x => x.At, ct);
        var currentCycles = await db.MonthlyCycles.AsNoTracking()
            .Where(c => ids.Contains(c.GroupId) && db.Groups.Any(g => g.Id == c.GroupId && g.CurrentCycleNumber == c.CycleNumber)).ToListAsync(ct);
        var snapshots = (await Snapshots(currentCycles, ct)).ToDictionary(s => currentCycles.Single(c => c.Id == s.Id).GroupId);
        var organizerIds = groups.Where(g => g.CreatorType == GroupCreatorType.Organizer).Select(g => g.CreatedByUserId).Distinct().ToArray();
        var organizerNames = new Dictionary<Guid, (string? Name, string? Status)>();
        foreach (var id in organizerIds) organizerNames[id] = ((await users.FindAsync(id, ct))?.Name, await organizers.GetStatusAsync(id, ct));
        var rows = new List<AdminGroupOperationsRow>(groups.Count);
        foreach (var g in groups)
        {
            int Count(MembershipStatus s) => memberCounts.Where(x => x.GroupId == g.Id && x.Status == s).Sum(x => x.Count);
            var ruleId = currentRuleIds.GetValueOrDefault(g.Id);
            var pendingTerms = termsPending.Count(x => x.GroupId == g.Id && !(x.TermsAcceptedAt.HasValue && x.TermsVersionId == ruleId && ruleId != Guid.Empty));
            var organizer = g.CreatorType == GroupCreatorType.Organizer ? organizerNames.GetValueOrDefault(g.CreatedByUserId) : default;
            rows.Add(new(g.Id, g.Name, Name(g.CreatorType), Name(g.GroupType), Name(g.Rules.CollectionMode), g.CreatedByUserId, organizer.Name, organizer.Status,
                g.GroupValue, g.MonthlyContribution, g.MemberLimit, g.CurrentMemberCount, Count(MembershipStatus.Active) + Count(MembershipStatus.Approved) + Count(MembershipStatus.Completed), Count(MembershipStatus.Applied), pendingTerms,
                Name(g.Status), g.StatusReason, g.Rules.StartDate, g.CreatedAt, g.ActivatedAt, g.DurationMonths, g.CurrentCycleNumber,
                snapshots.GetValueOrDefault(g.Id), AdminPaymentCounts.Empty, AdminPayoutCounts.Empty,
                lastActivity.TryGetValue(g.Id, out var at) ? at : g.UpdatedAt));
        }
        return rows;
    }

    public async Task<IReadOnlyList<AdminCycleSnapshot>> CyclesAsync(Guid groupId, CancellationToken ct)
    {
        var cycles = await db.MonthlyCycles.AsNoTracking().Where(c => c.GroupId == groupId).OrderBy(c => c.CycleNumber).ToListAsync(ct);
        return await Snapshots(cycles, ct);
    }

    private async Task<IReadOnlyList<AdminCycleSnapshot>> Snapshots(List<MonthlyCycle> cycles, CancellationToken ct)
    {
        if (cycles.Count == 0) return [];
        var cycleIds = cycles.Select(c => c.Id).ToArray();
        var auctions = await db.Auctions.AsNoTracking().Where(a => cycleIds.Contains(a.CycleId)).ToListAsync(ct);
        var bidCounts = await db.AuctionBids.AsNoTracking().Where(b => cycleIds.Contains(b.CycleId)).GroupBy(b => b.CycleId).Select(x => new { CycleId = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.CycleId, x => x.Count, ct);
        var resultIds = cycles.Where(c => c.SelectionResultId.HasValue).Select(c => c.SelectionResultId!.Value).ToArray();
        var results = await db.SelectionResults.AsNoTracking().Where(r => resultIds.Contains(r.Id)).ToListAsync(ct);
        var winnerNames = new Dictionary<Guid, string>();
        foreach (var userId in results.Select(r => r.WinnerUserId).Distinct()) winnerNames[userId] = (await users.FindAsync(userId, ct))?.Name ?? "Member";
        return cycles.Select(c =>
        {
            var financial = c.CollectionMode == ContributionCollectionMode.Razorpay;
            var settledMembers = financial ? c.FinanciallySettledMemberCount : c.FullyRecordedMemberCount;
            var auction = auctions.FirstOrDefault(a => a.CycleId == c.Id);
            var result = c.SelectionResultId.HasValue ? results.FirstOrDefault(r => r.Id == c.SelectionResultId) : null;
            return new AdminCycleSnapshot(c.Id, c.CycleNumber, Name(c.Status), Name(c.SelectionMethod), Name(c.CollectionMode),
                c.ContributionDueDate, c.SelectionDate, c.PayoutDate, c.ExpectedMemberCount, settledMembers, c.ExpectedMemberCount - settledMembers,
                c.ExpectedPoolAmount, financial ? c.FinanciallySettledAmount : c.RecordedContributionAmount, c.FullyRecordedMemberCount, c.RecordedContributionAmount,
                c.StartedAt, c.ReadyForSelectionAt, c.SelectionCompletedAt, c.CompletedAt, c.SelectionResultId,
                result is null ? null : winnerNames.GetValueOrDefault(result.WinnerUserId), result?.WinnerSlotNumber,
                auction is null ? null : Name(auction.Status), auction?.StartsAt, auction?.EndsAt, bidCounts.GetValueOrDefault(c.Id));
        }).ToArray();
    }

    public async Task<IReadOnlyList<AdminOutstandingContribution>> OutstandingContributionsAsync(Guid groupId, Guid cycleId, CancellationToken ct)
    {
        var cycle = await db.MonthlyCycles.AsNoTracking().SingleOrDefaultAsync(c => c.Id == cycleId && c.GroupId == groupId, ct);
        if (cycle is null) return [];
        var financial = cycle.CollectionMode == ContributionCollectionMode.Razorpay;
        var rows = await db.Contributions.AsNoTracking().Where(c => c.CycleId == cycleId && c.GroupId == groupId)
            .Where(c => financial ? c.FinanciallySettledAmount < c.ExpectedAmount : c.RecordedAmount < c.ExpectedAmount).ToListAsync(ct);
        var membershipIds = rows.Select(r => r.MembershipId).ToArray();
        var memberships = await db.Memberships.AsNoTracking().Where(m => membershipIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id, ct);
        var names = new Dictionary<Guid, string>();
        foreach (var userId in memberships.Values.Select(m => m.UserId).Distinct()) names[userId] = (await users.FindAsync(userId, ct))?.Name ?? "Member";
        return rows.OrderBy(r => memberships[r.MembershipId].SlotNumber).Select(r => new AdminOutstandingContribution(r.Id, r.MembershipId, names[memberships[r.MembershipId].UserId],
            memberships[r.MembershipId].SlotNumber, r.ExpectedAmount, r.FinanciallySettledAmount, r.RecordedAmount, Name(r.Status), Name(r.FinancialStatus), r.DueDate)).ToArray();
    }

    public async Task<IReadOnlyList<AdminActivityEntry>> ActivityAsync(Guid groupId, int limit, CancellationToken ct)
    {
        var events = await db.AuditEvents.AsNoTracking().Where(e => e.GroupId == groupId).OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).Take(Math.Clamp(limit, 1, 200)).ToListAsync(ct);
        var actors = new Dictionary<Guid, string?>();
        foreach (var id in events.Select(e => e.ActorUserId).Distinct()) actors[id] = (await users.FindAsync(id, ct))?.Name;
        return events.Select(e => new AdminActivityEntry(e.Id, e.CreatedAt, "GROUP", e.Action, actors[e.ActorUserId], null, e.SubjectId, e.CycleId)).ToArray();
    }

    public async Task<AdminGroupOverview> OverviewAsync(CancellationToken ct)
    {
        var byStatus = await db.Groups.AsNoTracking().GroupBy(g => g.Status).Select(x => new { Status = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Status, x => x.Count, ct);
        int Count(GroupStatus s) => byStatus.GetValueOrDefault(s);
        var activeMembers = await db.Memberships.AsNoTracking().CountAsync(m => m.Status == MembershipStatus.Active, ct);
        var platform = db.Groups.AsNoTracking().Where(g => g.CreatorType == GroupCreatorType.Platform);
        var readyToActivate = await Bucket(platform.Where(g => g.Status == GroupStatus.ReadyToStart).Select(g => g.UpdatedAt), ct);
        // Fully subscribed platform groups whose approved members have all accepted the current rules: confirmation is possible now.
        var readyToConfirm = await Bucket(platform.Where(g => g.Status == GroupStatus.FullySubscribed &&
            !db.Memberships.Any(m => m.GroupId == g.Id && m.Status == MembershipStatus.Approved &&
                !db.RuleVersions.Any(v => v.GroupId == g.Id && v.VersionNumber == g.RulesVersion && v.Id == m.TermsVersionId && m.TermsAcceptedAt != null))).Select(g => g.UpdatedAt), ct);
        var applications = await Bucket(db.Memberships.AsNoTracking().Where(m => m.Status == MembershipStatus.Applied && db.Groups.Any(g => g.Id == m.GroupId && g.CreatorType == GroupCreatorType.Platform)).Select(m => m.AppliedAt), ct);
        var awaitingOrganizer = await Bucket(db.Groups.AsNoTracking().Where(g => g.CreatorType == GroupCreatorType.Organizer && (g.Status == GroupStatus.ReadyToStart || g.Status == GroupStatus.FullySubscribed)).Select(g => g.UpdatedAt), ct);
        var suspended = await Bucket(db.Groups.AsNoTracking().Where(g => g.Status == GroupStatus.Suspended).Select(g => g.UpdatedAt), ct);
        var current = db.MonthlyCycles.AsNoTracking().Where(c => db.Groups.Any(g => g.Id == c.GroupId && g.CurrentCycleNumber == c.CycleNumber && g.Status == GroupStatus.Active));
        var collecting = await current.CountAsync(c => c.Status == CycleStatus.CollectingContributions, ct);
        var today = BusinessCalendar.Today(clock.UtcNow);
        var overdueDates = await current.Where(c => c.Status == CycleStatus.CollectingContributions && c.ContributionDueDate < today).Select(c => c.ContributionDueDate).ToListAsync(ct);
        var overdue = overdueDates.Count == 0 ? AdminAttentionBucket.Empty : new AdminAttentionBucket(overdueDates.Count, new DateTimeOffset(overdueDates.Min().ToDateTime(TimeOnly.MinValue), TimeSpan.Zero));
        var platformReady = await Bucket(current.Where(c => c.Status == CycleStatus.ReadyForSelection && db.Groups.Any(g => g.Id == c.GroupId && g.CreatorType == GroupCreatorType.Platform)).Select(c => c.ReadyForSelectionAt ?? c.UpdatedAt), ct);
        var organizerReady = await Bucket(current.Where(c => c.Status == CycleStatus.ReadyForSelection && db.Groups.Any(g => g.Id == c.GroupId && g.CreatorType == GroupCreatorType.Organizer)).Select(c => c.ReadyForSelectionAt ?? c.UpdatedAt), ct);
        // Only gateway-collected cycles can be prepared for payout (the ledger pool must be funded); manual-tracking cycles are not an admin action.
        var selectionCompleted = await Bucket(current.Where(c => c.Status == CycleStatus.SelectionCompleted && c.CollectionMode == ContributionCollectionMode.Razorpay).Select(c => c.SelectionCompletedAt ?? c.UpdatedAt), ct);
        var payoutPending = await current.CountAsync(c => c.Status == CycleStatus.PayoutPending, ct);
        var auctionsOpen = await Bucket(db.Auctions.AsNoTracking().Where(a => a.Status == AuctionStatus.Open).Select(a => a.OpenedAt ?? a.UpdatedAt), ct);
        var noBids = await Bucket(db.Auctions.AsNoTracking().Where(a => a.Status == AuctionStatus.ClosedNoBids).Select(a => a.ClosedAt ?? a.UpdatedAt), ct);
        return new(byStatus.Values.Sum(), Count(GroupStatus.Draft), Count(GroupStatus.Recruiting) + Count(GroupStatus.Published), Count(GroupStatus.FullySubscribed), Count(GroupStatus.ReadyToStart),
            Count(GroupStatus.Active) + Count(GroupStatus.Completing), Count(GroupStatus.Completed), Count(GroupStatus.Suspended), Count(GroupStatus.Cancelled), activeMembers,
            readyToActivate, readyToConfirm, applications, awaitingOrganizer, suspended,
            collecting, overdue, platformReady, organizerReady, selectionCompleted, payoutPending, auctionsOpen, noBids);
    }

    private static async Task<AdminAttentionBucket> Bucket(IQueryable<DateTimeOffset> since, CancellationToken ct)
    {
        var count = await since.CountAsync(ct);
        return count == 0 ? AdminAttentionBucket.Empty : new(count, await since.MinAsync(ct));
    }
}
