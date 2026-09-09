using Dhanvi.Modules.Auctions.Application;
using Microsoft.Extensions.DependencyInjection;
namespace Dhanvi.Modules.Auctions.Infrastructure;
public static class AuctionsModule
{
    public static IServiceCollection AddAuctionsModule(this IServiceCollection services) => services.AddScoped<IAuctionService, AuctionService>();
}
