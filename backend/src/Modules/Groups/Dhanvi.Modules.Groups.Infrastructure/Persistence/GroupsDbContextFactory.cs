using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence;

public sealed class GroupsDbContextFactory : IDesignTimeDbContextFactory<GroupsDbContext>
{
    public GroupsDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
            ?? "Host=localhost;Port=5432;Database=dhanvi;Username=dhanvi;Password=dhanvi";
        var options = new DbContextOptionsBuilder<GroupsDbContext>()
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "groups"))
            .Options;
        return new GroupsDbContext(options);
    }
}

