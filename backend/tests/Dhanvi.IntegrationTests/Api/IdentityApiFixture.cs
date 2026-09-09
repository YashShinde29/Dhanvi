using System.Collections.Concurrent;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace Dhanvi.IntegrationTests.Api;

public sealed class IdentityApiFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine")
        .WithDatabase("dhanvi_identity_tests")
        .WithUsername("dhanvi")
        .WithPassword("integration-test-only")
        .Build();

    public TestEmailSender EmailSender { get; } = new();
    public IdentityApiFactory Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        Factory = new IdentityApiFactory(_postgres.GetConnectionString(), EmailSender);
        using var client = Factory.CreateClient();
        using var response = await client.GetAsync("/api/v1/health");
        response.EnsureSuccessStatusCode();
    }

    public async Task DisposeAsync()
    {
        Factory.Dispose();
        await _postgres.DisposeAsync();
    }
}

public sealed class IdentityApiFactory(string connectionString, TestEmailSender emailSender, Dhanvi.SharedKernel.Time.IDateTimeProvider? clock = null, Dhanvi.Modules.RandomDraws.Application.ISecureRandomSource? random = null) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = connectionString,
                ["Database:ApplyMigrations"] = "true",
                ["Jwt:SigningKey"] = "integration-test-signing-key-with-at-least-32-characters",
                ["Jwt:SecureCookies"] = "false",
                ["DHANVI_SEED_ADMIN_ENABLED"] = "true",
                ["DHANVI_SEED_ADMIN_EMAIL"] = "admin@dhanvi.test",
                ["DHANVI_SEED_ADMIN_PASSWORD"] = "AdminPassword@123",
            }));
        builder.ConfigureTestServices(services =>
        {
            if (random is not null) { services.RemoveAll<Dhanvi.Modules.RandomDraws.Application.ISecureRandomSource>(); services.AddSingleton(random); }
            if (clock is not null) { services.RemoveAll<Dhanvi.SharedKernel.Time.IDateTimeProvider>(); services.AddSingleton(clock); }
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(emailSender);
        });
    }
}

public sealed class TestEmailSender : IEmailSender
{
    private readonly ConcurrentDictionary<string, string> _resetTokens = new(StringComparer.OrdinalIgnoreCase);

    public Task SendPasswordResetAsync(string email, string resetToken, CancellationToken cancellationToken)
    {
        _resetTokens[email] = resetToken;
        return Task.CompletedTask;
    }

    public string GetResetToken(string email) => _resetTokens[email];
}
