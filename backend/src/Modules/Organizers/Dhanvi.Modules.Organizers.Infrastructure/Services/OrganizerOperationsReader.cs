using Dhanvi.Modules.Admin.Application;
using Dhanvi.Modules.Organizers.Domain;
using Dhanvi.Modules.Organizers.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Organizers.Infrastructure.Services;

/// <summary>Admin read model over organizer applications and profiles.</summary>
internal sealed class OrganizerOperationsReader(OrganizerDbContext db) : IOrganizerOperationsReader
{
    public async Task<AdminOrganizerOverview> OverviewAsync(CancellationToken ct)
    {
        var pending = db.OrganizerApplications.AsNoTracking().Where(a => a.Status == OrganizerStatus.Pending || a.Status == OrganizerStatus.UnderReview);
        var count = await pending.CountAsync(ct);
        return new(count == 0 ? AdminAttentionBucket.Empty : new(count, await pending.MinAsync(a => a.SubmittedAt, ct)),
            await db.OrganizerApplications.AsNoTracking().CountAsync(a => a.Status == OrganizerStatus.UnderReview, ct),
            await db.OrganizerProfiles.AsNoTracking().CountAsync(p => p.Status == OrganizerStatus.Approved, ct),
            await db.OrganizerProfiles.AsNoTracking().CountAsync(p => p.Status == OrganizerStatus.Suspended, ct));
    }
}
