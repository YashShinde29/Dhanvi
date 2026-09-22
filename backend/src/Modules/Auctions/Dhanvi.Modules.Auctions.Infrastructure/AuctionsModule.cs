using Dhanvi.Modules.Auctions.Application;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
namespace Dhanvi.Modules.Auctions.Infrastructure;
public static class AuctionsModule
{
    public static IServiceCollection AddAuctionsModule(this IServiceCollection services)
    {
        services.TryAddSingleton<IAuctionEventHook, NoopAuctionEventHook>();
        return services.AddScoped<IAuctionService, AuctionService>();
    }
}
