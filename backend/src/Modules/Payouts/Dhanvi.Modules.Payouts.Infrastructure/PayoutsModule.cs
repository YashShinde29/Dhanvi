using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Application;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
namespace Dhanvi.Modules.Payouts.Infrastructure;
public static class PayoutsModule
{
    public static IServiceCollection AddPayoutsModule(this IServiceCollection services, IConfiguration configuration)
    {
        if ((configuration["Payouts:Provider"] ?? "FAKE") != "FAKE") throw new InvalidOperationException("Only FAKE outgoing payouts are supported. Production payouts are disabled.");
        if (!Enum.TryParse<Dhanvi.Modules.Payouts.Domain.GatewayPayoutStatus>(configuration["Payouts:Fake:Outcome"] ?? "Success", true, out var outcome) || !Enum.IsDefined(outcome))
            throw new InvalidOperationException("Fake payout outcome must be Success, Pending or Failed.");
        services.AddDbContext<PayoutsDbContext>(o => o.UseNpgsql(configuration.GetConnectionString("DefaultConnection"), n => n.MigrationsHistoryTable("__EFMigrationsHistory", "payouts")));
        services.AddScoped<IPayoutService, PayoutService>(); services.AddSingleton<IPayoutApprovalPolicy, AdminPayoutApprovalPolicy>();
        services.AddSingleton<IPayoutGateway, FakePayoutGateway>(); services.AddScoped<IPayoutLedgerReader, PayoutLedgerReader>();
        return services;
    }
}
