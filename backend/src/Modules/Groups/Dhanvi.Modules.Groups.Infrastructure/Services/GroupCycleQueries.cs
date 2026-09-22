using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

internal sealed partial class GroupCycleService
{
    public async Task<IReadOnlyList<CycleDetails>> CyclesAsync(Guid groupId, GroupActor actor, bool management, CancellationToken ct)
    {
        var group = await ReadableGroup(groupId, actor, management, ct);
        var cycles = await db.MonthlyCycles.AsNoTracking().Where(c => c.GroupId == groupId).OrderBy(c => c.CycleNumber).ToListAsync(ct);
        // One query for every auction row of the group; cycles without a row get the rule-derived window (what Scheduled() would create).
        var auctions = group.GroupType == GroupType.Auction ? await db.Auctions.AsNoTracking().Where(a => a.GroupId == groupId).ToDictionaryAsync(a => a.CycleId, ct) : new Dictionary<Guid, Auction>();
        return cycles.Select(c => WithAuction(MapCycle(c, group.GroupTimeZone), c, group, auctions.GetValueOrDefault(c.Id))).ToArray();
    }
    public async Task<CycleDetails> CycleAsync(Guid groupId, Guid cycleId, GroupActor actor, CancellationToken ct)
    {
        var group = await ReadableGroup(groupId, actor, false, ct);
        var cycle = await db.MonthlyCycles.AsNoTracking().SingleOrDefaultAsync(c => c.GroupId == groupId && c.Id == cycleId, ct) ?? throw new NotFoundException("Cycle not found.");
        return WithAuction(MapCycle(cycle, group.GroupTimeZone), cycle, group, group.GroupType == GroupType.Auction ? await db.Auctions.AsNoTracking().SingleOrDefaultAsync(a => a.CycleId == cycleId, ct) : null);
    }
    private static CycleDetails WithAuction(CycleDetails details, MonthlyCycle cycle, Group group, Auction? auction)
    {
        if (cycle.SelectionMethod != SelectionMethod.Auction) return details;
        if (auction is not null) return details with { AuctionStartsAt = auction.StartsAt, AuctionEndsAt = auction.EndsAt, AuctionStatus = System.Text.Json.JsonNamingPolicy.SnakeCaseUpper.ConvertName(auction.Status.ToString()), AuctionRescheduleCount = auction.RescheduleCount };
        var rules = group.Rules.AuctionRules; if (rules is null) return details;
        // Rule times are UTC clock times (see AuctionService.Scheduled); the calendar day is the cycle's selection date.
        DateTimeOffset Utc(TimeOnly time) => new(cycle.SelectionDate.ToDateTime(time, DateTimeKind.Unspecified), TimeSpan.Zero);
        return details with { AuctionStartsAt = Utc(rules.AuctionStartTime), AuctionEndsAt = Utc(rules.AuctionEndTime), AuctionStatus = "SCHEDULED" };
    }
    public async Task<ContributionPage> MyContributionsAsync(GroupActor actor, Guid? groupId, ContributionStatus? status, int page, int pageSize, CancellationToken ct)
    {
        var query = db.Contributions.AsNoTracking().Where(c => db.Memberships.Any(m => m.Id == c.MembershipId && m.UserId == actor.UserId));
        if (groupId.HasValue) query = query.Where(c => c.GroupId == groupId);
        if (status.HasValue) query = query.Where(c => c.Status == status);
        page = Math.Clamp(page, 1, 100000); pageSize = Math.Clamp(pageSize, 1, 100);
        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(c => c.DueDate).ThenBy(c => c.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new(await MapContributions(items, false, ct), page, pageSize, total);
    }
    public async Task<IReadOnlyList<ContributionDetails>> MyGroupContributionsAsync(Guid groupId, GroupActor actor, CancellationToken ct)
    {
        GroupRules.Require(await db.Memberships.AnyAsync(m => m.GroupId == groupId && m.UserId == actor.UserId && (m.Status == MembershipStatus.Approved || m.Status == MembershipStatus.Active || m.Status == MembershipStatus.Completed), ct), "MEMBERSHIP_REQUIRED", "An approved/current membership is required.");
        var items = await db.Contributions.AsNoTracking().Where(c => c.GroupId == groupId && db.Memberships.Any(m => m.Id == c.MembershipId && m.UserId == actor.UserId)).OrderBy(c => c.DueDate).ToListAsync(ct);
        return await MapContributions(items, false, ct);
    }
    public async Task<IReadOnlyList<ContributionDetails>> ContributionsAsync(Guid groupId, Guid cycleId, GroupActor actor, CancellationToken ct)
    {
        await ReadableGroup(groupId, actor, true, ct);
        if (!await db.MonthlyCycles.AnyAsync(c => c.GroupId == groupId && c.Id == cycleId, ct)) throw new NotFoundException("Cycle not found in this group.");
        var items = await db.Contributions.AsNoTracking().Where(c => c.GroupId == groupId && c.CycleId == cycleId).ToListAsync(ct);
        return (await MapContributions(items, true, ct)).OrderBy(c => c.SlotNumber).ToArray();
    }
    private async Task<Group> ReadableGroup(Guid id, GroupActor actor, bool management, CancellationToken ct)
    {
        if (await users.FindAsync(actor.UserId, ct) is null) throw new UnauthorizedAccessException();
        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.Id == id, ct) ?? throw new NotFoundException("Group not found.");
        if (actor.IsAdmin) return group;
        if (group.CreatorType == GroupCreatorType.Organizer && group.CreatedByUserId == actor.UserId)
        {
            if (management) GroupRules.Require(await Approved(group, ct), "ORGANIZER_NOT_APPROVED", "Organizer must be approved for management access.");
            return group;
        }
        GroupRules.Require(!management && await db.Memberships.AnyAsync(m => m.GroupId == id && m.UserId == actor.UserId && (m.Status == MembershipStatus.Approved || m.Status == MembershipStatus.Active || m.Status == MembershipStatus.Completed), ct),
            management ? "NOT_GROUP_OWNER" : "MEMBERSHIP_REQUIRED", "You do not have access to this group's contribution information.");
        return group;
    }
    private async Task<IReadOnlyList<ContributionDetails>> MapContributions(IReadOnlyList<Contribution> items, bool management, CancellationToken ct)
    {
        var ids = items.Select(c => c.Id).ToArray(); var groupIds = items.Select(c => c.GroupId).Distinct().ToArray();
        var cycleIds = items.Select(c => c.CycleId).Distinct().ToArray(); var membershipIds = items.Select(c => c.MembershipId).Distinct().ToArray();
        var groups = await db.Groups.AsNoTracking().Where(g => groupIds.Contains(g.Id)).ToDictionaryAsync(g => g.Id, ct);
        var cycles = await db.MonthlyCycles.AsNoTracking().Where(c => cycleIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
        var memberships = await db.Memberships.AsNoTracking().Where(m => membershipIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id, ct);
        var entries = management ? await db.ContributionEntries.AsNoTracking().Where(e => ids.Contains(e.ContributionId)).OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).ToListAsync(ct) : [];
        var names = new Dictionary<Guid, string>();
        if (management)
            foreach (var userId in memberships.Values.Select(m => m.UserId).Distinct()) names[userId] = (await users.FindAsync(userId, ct))?.Name ?? "Unavailable member";
        return items.Select(c => new ContributionDetails(c.Id, c.GroupId, groups[c.GroupId].Name, c.CycleId, cycles[c.CycleId].CycleNumber, c.MembershipId, memberships[c.MembershipId].SlotNumber,
            management ? names[memberships[c.MembershipId].UserId] : null, c.DueDate, groups[c.GroupId].GroupTimeZone, c.ExpectedAmount, c.RecordedAmount, c.Status, c.RecordedAt,
            entries.Where(e => e.ContributionId == c.Id).Select(MapEntry).ToArray(), groups[c.GroupId].Rules.CollectionMode, c.FinanciallySettledAmount, c.FinancialStatus)).ToArray();
    }
}
