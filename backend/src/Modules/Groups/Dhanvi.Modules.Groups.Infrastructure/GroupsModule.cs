using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dhanvi.Modules.Groups.Infrastructure;

public static class GroupsModule
{
    public static IServiceCollection AddGroupsModule(this IServiceCollection services)
    {
        services.AddDbContext<GroupsDbContext>((provider, options) =>
            options.UseNpgsql(provider.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")
                ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is required."), npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "groups")));
        services.AddScoped<Dhanvi.Modules.Groups.Application.IGroupService, Dhanvi.Modules.Groups.Infrastructure.Services.GroupService>();
        services.AddScoped<Services.GroupCycleService>();
        services.AddScoped<Dhanvi.Modules.Groups.Application.IGroupCycleService>(provider => provider.GetRequiredService<Services.GroupCycleService>());
        services.AddScoped<Dhanvi.Modules.Groups.Application.IContributionRecordingService>(provider => provider.GetRequiredService<Services.GroupCycleService>());
        services.AddScoped<Dhanvi.Modules.RandomDraws.Application.ISelectionStore, Services.SelectionStore>();
        services.AddScoped<Dhanvi.Modules.Auctions.Application.IAuctionStore, Services.AuctionStore>();
        services.AddScoped<Dhanvi.Modules.Ledger.Application.ILedgerSourceReader, Services.LedgerSourceReader>();
        return services;
    }
}

