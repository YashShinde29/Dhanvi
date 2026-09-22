using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

/// <summary>
/// Server-paged, newest-first schedule history. One query for the page, one count, one batched name lookup — never the
/// whole group's history, so a 50-cycle group with many reschedules costs the same as a single page.
/// </summary>
internal sealed class AuctionScheduleHistoryReader(GroupsDbContext db, IGroupUserDirectory users, IOrganizerStatusReader organizers) : IAuctionScheduleHistoryReader
{
    public async Task<AuctionScheduleHistoryPage> ReadAsync(Guid groupId, Guid? cycleId, int page, int pageSize, bool includeInternal, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 100000); pageSize = Math.Clamp(pageSize, 1, 50);
        var query = db.AuctionScheduleChanges.AsNoTracking().Where(c => c.GroupId == groupId);
        if (cycleId.HasValue) query = query.Where(c => c.CycleId == cycleId);
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(c => c.ChangedAt).ThenByDescending(c => c.ChangeSequence).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var cycleIds = rows.Select(r => r.CycleId).Distinct().ToArray();
        var numbers = await db.MonthlyCycles.AsNoTracking().Where(c => cycleIds.Contains(c.Id)).Select(c => new { c.Id, c.CycleNumber }).ToDictionaryAsync(c => c.Id, c => c.CycleNumber, ct);
        var names = new Dictionary<Guid, string>();
        if (includeInternal) foreach (var userId in rows.Select(r => r.ChangedByUserId).Distinct()) names[userId] = (await users.FindAsync(userId, ct))?.Name ?? "Unavailable";
        return new(rows.Select(r => new AuctionScheduleChangeDetails(r.Id, r.CycleId, numbers.GetValueOrDefault(r.CycleId), r.ChangeSequence, r.PreviousStartsAt, r.PreviousEndsAt, r.NewStartsAt, r.NewEndsAt,
            r.ReasonCode, includeInternal ? r.ReasonText : null, r.MemberMessage, includeInternal ? r.ChangedByRole : null, includeInternal ? names.GetValueOrDefault(r.ChangedByUserId) : null, r.ChangedAt)).ToArray(), page, pageSize, total);
    }
    public async Task<bool> OwnsGroupAsync(Guid groupId, Guid userId, CancellationToken ct)
    {
        var group = await db.Groups.AsNoTracking().Where(g => g.Id == groupId).Select(g => new { g.CreatorType, g.CreatedByUserId }).SingleOrDefaultAsync(ct);
        return group is { CreatorType: GroupCreatorType.Organizer } && group.CreatedByUserId == userId && await organizers.GetStatusAsync(userId, ct) == "APPROVED";
    }
}
