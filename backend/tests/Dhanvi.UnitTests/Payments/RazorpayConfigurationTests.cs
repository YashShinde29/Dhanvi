using System.Security.Cryptography;
using System.Text;
using Dhanvi.Modules.Payments.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Dhanvi.UnitTests.Payments;

public sealed class RazorpayConfigurationTests
{
    // Synthetic fixtures only. Never read actual credentials into automated tests.
    private static Dictionary<string, string?> Settings() => new()
    {
        ["Payment_RazorpayEnabled"] = "true",
        ["Payment_RazorpayKeyId"] = "rzp_test_offline_binding",
        ["Payment_RazorpayKeySecret"] = "offline-binding-key",
        ["Payment_RazorpayCheckoutReturnBaseUrl"] = "http://localhost:3000/checkout/return",
        ["Payment_WebhookEnabled"] = "true",
        ["Payment_WebhookSecret"] = "offline-binding-webhook"
    };

    private static ServiceProvider Services(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new ServiceCollection().AddLogging().AddPaymentsModule(configuration).BuildServiceProvider();
    }

    [Fact]
    public void ExactExportedVariableNamesBindAndValidateOnStartup()
    {
        var settings = Settings();
        using var services = Services(settings);
        services.GetRequiredService<IStartupValidator>().Validate();
        var options = services.GetRequiredService<IOptions<RazorpayOptions>>().Value;
        Assert.True(options.Enabled); Assert.True(options.WebhookEnabled);
        Assert.Equal("TEST", options.Environment);
        Assert.Equal(settings["Payment_RazorpayKeyId"], options.KeyId);
        Assert.Equal(settings["Payment_RazorpayKeySecret"], options.KeySecret);
        Assert.Equal(settings["Payment_WebhookSecret"], options.WebhookSecret);
        Assert.Equal(settings["Payment_RazorpayCheckoutReturnBaseUrl"], options.CheckoutReturnBaseUrl);
    }

    [Fact]
    public void EnvironmentProviderPreservesExactSingleUnderscoreNames()
    {
        // A unique prefix isolates the test from the user's real process credentials.
        var prefix = "DhanviOfflineBinding_" + Guid.NewGuid().ToString("N") + "_";
        var settings = Settings();
        try
        {
            foreach (var setting in settings) Environment.SetEnvironmentVariable(prefix + setting.Key, setting.Value);
            var configuration = new ConfigurationBuilder().AddEnvironmentVariables(prefix).Build();
            using var services = new ServiceCollection().AddLogging().AddPaymentsModule(configuration).BuildServiceProvider();
            services.GetRequiredService<IStartupValidator>().Validate();
            var options = services.GetRequiredService<IOptions<RazorpayOptions>>().Value;
            Assert.True(options.Enabled); Assert.True(options.WebhookEnabled);
            Assert.Equal(settings["Payment_RazorpayKeyId"], options.KeyId);
            Assert.Equal(settings["Payment_RazorpayKeySecret"], options.KeySecret);
            Assert.Equal(settings["Payment_WebhookSecret"], options.WebhookSecret);
            Assert.Equal(settings["Payment_RazorpayCheckoutReturnBaseUrl"], options.CheckoutReturnBaseUrl);
        }
        finally { foreach (var setting in settings) Environment.SetEnvironmentVariable(prefix + setting.Key, null); }
    }

    [Fact]
    public void ExactNamesOverrideLegacyConfigurationIncludingFalse()
    {
        var settings = Settings(); settings["Payment_RazorpayEnabled"] = "false";
        settings["Payment_WebhookEnabled"] = "false";
        settings["Payments:Razorpay:Enabled"] = "true";
        settings["RAZORPAY_KEY_ID"] = "rzp_live_unused";
        settings["RAZORPAY_KEY_SECRET"] = "unused-legacy-key";
        settings["RAZORPAY_WEBHOOK_SECRET"] = "unused-legacy-webhook";
        using var services = Services(settings);
        var options = services.GetRequiredService<IOptions<RazorpayOptions>>().Value;
        Assert.False(options.Enabled); Assert.False(options.WebhookEnabled);
        Assert.Equal(settings["Payment_RazorpayKeyId"], options.KeyId);
        Assert.Equal(settings["Payment_RazorpayKeySecret"], options.KeySecret);
        Assert.Equal(settings["Payment_WebhookSecret"], options.WebhookSecret);
    }

    [Theory]
    [InlineData("Payment_RazorpayKeyId", "rzp_live_rejected")]
    [InlineData("Payment_RazorpayKeyId", "")]
    [InlineData("Payment_RazorpayKeySecret", "")]
    [InlineData("Payment_WebhookSecret", "")]
    [InlineData("RAZORPAY_ENVIRONMENT", "LIVE")]
    [InlineData("Payment_RazorpayCheckoutReturnBaseUrl", "/relative")]
    [InlineData("Payment_RazorpayCheckoutReturnBaseUrl", "http://example.test/return")]
    [InlineData("Payment_RazorpayCheckoutReturnBaseUrl", "javascript:alert(1)")]
    public void InvalidConfigurationFailsStartupWithoutLeakingSecrets(string name, string value)
    {
        var settings = Settings(); settings[name] = value;
        using var services = Services(settings);
        var error = Assert.Throws<OptionsValidationException>(() => services.GetRequiredService<IStartupValidator>().Validate());
        Assert.DoesNotContain("offline-binding-key", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("offline-binding-webhook", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ConfiguredSecretsVerifyOnlyTheirRespectiveSignaturesAndWebhookSwitchIsEffective()
    {
        var settings = Settings(); using var services = Services(settings);
        var options = services.GetRequiredService<IOptions<RazorpayOptions>>().Value;
        using var http = new HttpClient();
        var gateway = new RazorpayPaymentGateway(http, Options.Create(options));
        var body = Encoding.UTF8.GetBytes("offline-payload");
        var signature = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.WebhookSecret), body));
        Assert.True(gateway.VerifyWebhookSignature(body, signature));
        Assert.False(gateway.VerifyPaymentSignature("order_offline", "pay_offline", signature));
        var checkoutSignature = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.KeySecret), Encoding.UTF8.GetBytes("order_offline|pay_offline")));
        Assert.True(gateway.VerifyPaymentSignature("order_offline", "pay_offline", checkoutSignature));
        Assert.False(gateway.VerifyPaymentSignature("order_other", "pay_offline", checkoutSignature));
        options.WebhookEnabled = false;
        Assert.False(gateway.VerifyWebhookSignature(body, signature));
    }
}
