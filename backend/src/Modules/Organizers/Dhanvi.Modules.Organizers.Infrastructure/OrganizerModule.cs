using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Organizers.Application;
using Dhanvi.Modules.Organizers.Infrastructure.Persistence;
using Dhanvi.Modules.Organizers.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dhanvi.Modules.Organizers.Infrastructure;

public static class OrganizerModule
{
    public static IServiceCollection AddOrganizerModule(this IServiceCollection services)
    {
        services.AddDbContext<OrganizerDbContext>((provider, options) => options.UseNpgsql(
            provider.GetRequiredService<NpgsqlConnection>(),
            npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history", "organizers")));
        services.AddScoped<IOrganizerService, OrganizerService>();
        services.AddScoped<IOrganizerStatusReader, OrganizerStatusReader>();
        return services;
    }
}

