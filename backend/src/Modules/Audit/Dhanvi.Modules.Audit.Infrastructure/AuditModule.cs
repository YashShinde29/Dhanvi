using Dhanvi.Modules.Audit.Application;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dhanvi.Modules.Audit.Infrastructure;

public static class AuditModule
{
    public static IServiceCollection AddAuditModule(this IServiceCollection services)
    {
        services.AddDbContext<AuditDbContext>((provider, options) => options.UseNpgsql(
            provider.GetRequiredService<NpgsqlConnection>(),
            npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history", "audit")));
        services.AddScoped<IAuditWriter, AuditWriter>();
        return services;
    }
}

