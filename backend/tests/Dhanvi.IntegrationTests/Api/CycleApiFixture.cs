using Dhanvi.SharedKernel.Time;
using Testcontainers.PostgreSql;
namespace Dhanvi.IntegrationTests.Api;

public sealed class CycleApiFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine").WithDatabase("dhanvi_cycle_tests").WithUsername("dhanvi").WithPassword("integration-test-only").Build();
    public AdjustableClock Clock { get; } = new();
    public IdentityApiFactory Factory { get; private set; } = null!;
    public async Task InitializeAsync() { await _postgres.StartAsync(); Factory = new(_postgres.GetConnectionString(), new TestEmailSender(), Clock); using var client = Factory.CreateClient(); using var response = await client.GetAsync("/api/v1/health"); response.EnsureSuccessStatusCode(); }
    public async Task DisposeAsync() { Factory.Dispose(); await _postgres.DisposeAsync(); }
}
public sealed class AdjustableClock : IDateTimeProvider
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);
}
