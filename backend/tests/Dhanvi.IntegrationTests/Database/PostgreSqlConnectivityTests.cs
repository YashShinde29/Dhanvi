using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace Dhanvi.IntegrationTests.Database;

public sealed class PostgreSqlConnectivityTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine")
        .WithDatabase("dhanvi_tests")
        .WithUsername("dhanvi")
        .WithPassword("integration-test-only")
        .Build();

    public Task InitializeAsync() => _postgres.StartAsync();
    public Task DisposeAsync() => _postgres.DisposeAsync().AsTask();

    [Fact]
    [Trait("Category", "Integration")]
    public async Task GroupsContextCanConnectToPostgreSql()
    {
        var options = new DbContextOptionsBuilder<GroupsDbContext>()
            .UseNpgsql(_postgres.GetConnectionString())
            .Options;
        await using var context = new GroupsDbContext(options);

        var canConnect = await context.Database.CanConnectAsync(CancellationToken.None);

        Assert.True(canConnect);
    }
}
