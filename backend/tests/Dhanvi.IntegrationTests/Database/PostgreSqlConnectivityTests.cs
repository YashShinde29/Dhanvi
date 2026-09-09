using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;


namespace Dhanvi.IntegrationTests.Database;

public sealed class PostgreSqlConnectivityTests : IAsyncLifetime, IAsyncDisposable
{
    ValueTask IAsyncDisposable.DisposeAsync() => new(DisposeAsync());
    private readonly TestPostgres _postgres = new();

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
