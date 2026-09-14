using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Application;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Payments.Infrastructure;
public static class PaymentsModule
{
    public static IServiceCollection AddPaymentsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<RazorpayOptions>().Configure(o => {
            o.Enabled = configuration.GetValue<bool?>("Payment_RazorpayEnabled") ?? configuration.GetValue<bool>("Payments:Razorpay:Enabled");
            o.Environment = configuration["RAZORPAY_ENVIRONMENT"] ?? "TEST";
            o.KeyId = configuration["Payment_RazorpayKeyId"] ?? configuration["RAZORPAY_KEY_ID"] ?? "";
            o.KeySecret = configuration["Payment_RazorpayKeySecret"] ?? configuration["RAZORPAY_KEY_SECRET"] ?? "";
            o.CheckoutReturnBaseUrl = configuration["Payment_RazorpayCheckoutReturnBaseUrl"] ?? "";
            o.WebhookEnabled = configuration.GetValue<bool?>("Payment_WebhookEnabled") ?? true;
            o.WebhookSecret = configuration["Payment_WebhookSecret"] ?? configuration["RAZORPAY_WEBHOOK_SECRET"] ?? "";
        }).Validate(o => o.Valid(), "Only complete Razorpay TEST credentials are accepted.").ValidateOnStart();
        services.AddHttpClient<IPaymentGateway, RazorpayPaymentGateway>(http => {
            http.BaseAddress = new Uri("https://api.razorpay.com/v1/"); http.Timeout = TimeSpan.FromSeconds(15);
        });
        services.AddDbContext<PaymentsDbContext>(o => o.UseNpgsql(configuration.GetConnectionString("DefaultConnection"),
            n => n.MigrationsHistoryTable("__EFMigrationsHistory", "payments")));
        services.AddScoped<IPaymentService, PaymentService>();
        services.AddScoped<ICapturedPaymentReader, CapturedPaymentReader>();
        return services;
    }
}
