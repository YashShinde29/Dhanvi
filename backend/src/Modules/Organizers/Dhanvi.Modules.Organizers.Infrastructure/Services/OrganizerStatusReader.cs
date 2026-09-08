using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Organizers.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Dhanvi.Modules.Organizers.Infrastructure.Services;

internal sealed class OrganizerStatusReader(OrganizerDbContext dbContext) : IOrganizerStatusReader
{
    public async Task<string> GetStatusAsync(Guid userId, CancellationToken cancellationToken)
    {
        var profile = await dbContext.OrganizerProfiles.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        return profile is null ? "NOT_APPLIED" : OrganizerService.StatusName(profile.Status);
    }
}
