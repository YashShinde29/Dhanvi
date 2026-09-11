using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
namespace Dhanvi.Modules.Ledger.Infrastructure;

public static class LedgerModule
{
    public static IServiceCollection AddLedgerModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<LedgerDbContext>(o => o.UseNpgsql(configuration.GetConnectionString("DefaultConnection"), n => n.MigrationsHistoryTable("__EFMigrationsHistory", "ledger")));
        services.AddOptions<LedgerPolicyOptions>().Configure(p => {
            var configured = configuration["Ledger:FeeRecognition"];
            if (configured is not null) p.FeeRecognition = Enum.TryParse<FeeRecognitionPolicy>(configured, true, out var value) ? value : throw new InvalidOperationException("Invalid ledger fee policy.");
        }).Validate(p => Enum.IsDefined(p.FeeRecognition), "Invalid ledger fee policy.").ValidateOnStart();
        services.AddScoped<LedgerSeeder>(); services.AddScoped<ILedgerPostingService, LedgerPostingService>(); services.AddScoped<ILedgerQueries, LedgerQueries>();
        return services;
    }
}
public sealed class LedgerSeeder(LedgerDbContext db, IDateTimeProvider clock)
{
    public async Task SeedAsync(CancellationToken ct)
    {
        foreach (var definition in ChartOfAccounts.SystemAccounts)
        {
            var account = LedgerAccount.Create(definition, clock.UtcNow);
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO ledger.\"LedgerAccounts\" (\"Id\",\"Code\",\"Name\",\"AccountType\",\"NormalBalance\",\"IsSystem\",\"IsActive\",\"CreatedAt\") VALUES ({account.Id},{account.Code},{account.Name},{account.AccountType.ToString()},{account.NormalBalance.ToString()},{true},{true},{account.CreatedAt}) ON CONFLICT (\"Code\") DO NOTHING", ct);
        }
    }
}
