using Microsoft.EntityFrameworkCore;

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence;

public sealed class GroupsDbContext(DbContextOptions<GroupsDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("groups");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(GroupsDbContext).Assembly);
    }
}

