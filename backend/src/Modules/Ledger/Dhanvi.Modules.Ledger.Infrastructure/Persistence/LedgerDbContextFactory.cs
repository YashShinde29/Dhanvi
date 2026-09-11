using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Dhanvi.Modules.Ledger.Infrastructure.Persistence;

public sealed class LedgerDbContextFactory : IDesignTimeDbContextFactory<LedgerDbContext>
{
    public LedgerDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<LedgerDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection") ?? "Host=localhost;Database=dhanvi;Username=dhanvi;Password=dhanvi",
            o => o.MigrationsHistoryTable("__EFMigrationsHistory", "ledger")).Options);
}
