using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Dhanvi.Modules.Organizers.Infrastructure.Persistence;

public sealed class OrganizerDbContextFactory : IDesignTimeDbContextFactory<OrganizerDbContext>
{
    public OrganizerDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings__DefaultConnection is required for migrations.");
        var options = new DbContextOptionsBuilder<OrganizerDbContext>()
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history", "organizers"))
            .Options;
        return new OrganizerDbContext(options);
    }
}

