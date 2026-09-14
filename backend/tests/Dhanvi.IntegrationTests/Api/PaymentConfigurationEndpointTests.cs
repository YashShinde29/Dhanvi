using System.Net;
using System.Text;
using Dhanvi.Modules.Payments.Infrastructure;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Dhanvi.IntegrationTests.Api;

public sealed partial class CycleEndpointTests
{
    [Fact]
    public async Task PaymentDisabledWebhookRejectsBeforeParsingOrSettlement()
    {
        using var factory = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(
            services => services.PostConfigure<RazorpayOptions>(options => options.WebhookEnabled = false)));
        using var client = factory.CreateClient();
        using var body = new StringContent("not-json", Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/v1/payments/webhooks/razorpay", body);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("WEBHOOKS_DISABLED", await response.Content.ReadAsStringAsync());
    }
}
