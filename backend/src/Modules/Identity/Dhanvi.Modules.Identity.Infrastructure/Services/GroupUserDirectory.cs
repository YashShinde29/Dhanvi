using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Identity.Infrastructure.Services;
internal sealed class GroupUserDirectory(IdentityDbContext db) : IGroupUserDirectory
{
    public Task<GroupUserInfo?> FindAsync(Guid userId, CancellationToken cancellationToken) => db.Users.AsNoTracking()
        .Where(x => x.Id == userId && x.IsActive)
        .Select(x => new GroupUserInfo(x.Id, x.FirstName + " " + x.LastName, x.Email, x.PhoneNumber, x.EmailVerified, x.CreatedAt)).SingleOrDefaultAsync(cancellationToken);
}
