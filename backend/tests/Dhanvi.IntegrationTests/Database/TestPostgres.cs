using Npgsql;
using Testcontainers.PostgreSql;

namespace Dhanvi.IntegrationTests.Database;

// Default remains Testcontainers. An explicit test-server connection enables the
// same real PostgreSQL tests on machines where Docker cannot start.
internal sealed class TestPostgres : IAsyncDisposable
{
    private readonly string? _server = Environment.GetEnvironmentVariable("DHANVI_TEST_POSTGRES");
    private readonly string _databaseName = "dhanvi_test_" + Guid.NewGuid().ToString("N");
    private PostgreSqlContainer? _container;
    private bool _created;

    public async Task StartAsync()
    {
        if (string.IsNullOrWhiteSpace(_server))
        {
            _container = new PostgreSqlBuilder("postgres:18-alpine").WithDatabase(_databaseName)
                .WithUsername("dhanvi").WithPassword("integration-test-only").Build();
            await _container.StartAsync();
            return;
        }
        await using var connection = new NpgsqlConnection(_server);
        await connection.OpenAsync();
        // This identifier is generated above and never comes from configuration.
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{_databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
        _created = true;
    }

    public string GetConnectionString() => _container is not null ? _container.GetConnectionString()
        : new NpgsqlConnectionStringBuilder(_server) { Database = _databaseName }.ConnectionString;

    public async ValueTask DisposeAsync()
    {
        if (_container is not null) { await _container.DisposeAsync(); return; }
        if (!_created) return;
        await using var connection = new NpgsqlConnection(_server);
        await connection.OpenAsync();
        // Only a database successfully created by this fixture can be dropped.
        await using var command = new NpgsqlCommand($"DROP DATABASE \"{_databaseName}\" WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync();
        _created = false;
    }
}
