using Dhanvi.SharedKernel.Time;
using Testcontainers.PostgreSql;
namespace Dhanvi.IntegrationTests.Api;

public sealed class CycleApiFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine").WithDatabase("dhanvi_cycle_tests").WithUsername("dhanvi").WithPassword("integration-test-only").Build();
    public AdjustableClock Clock { get; } = new();
    public CountingRandomSource RandomSource { get; } = new();
    public IdentityApiFactory Factory { get; private set; } = null!;
    public async Task InitializeAsync() { await _postgres.StartAsync(); Factory = new(_postgres.GetConnectionString(), new TestEmailSender(), Clock, RandomSource); using var client = Factory.CreateClient(); using var response = await client.GetAsync("/api/v1/health"); response.EnsureSuccessStatusCode(); }
    public async Task DisposeAsync() { Factory.Dispose(); await _postgres.DisposeAsync(); }
}
public sealed class AdjustableClock : IDateTimeProvider
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);
}

public sealed class CountingRandomSource : Dhanvi.Modules.RandomDraws.Application.ISecureRandomSource
{
    private int _calls;
    public int Calls => System.Threading.Volatile.Read(ref _calls);
    public string SourceType => "DETERMINISTIC_TEST";
    public byte[] CreateSeed() { System.Threading.Interlocked.Increment(ref _calls); return Enumerable.Range(0, 32).Select(i => (byte)i).ToArray(); }
}
