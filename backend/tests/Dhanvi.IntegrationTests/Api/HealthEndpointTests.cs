using System.Net;
using System.Net.Http.Json;

namespace Dhanvi.IntegrationTests.Api;

public sealed class HealthEndpointTests(DhanviApiFactory factory) : IClassFixture<DhanviApiFactory>
{
    [Fact]
    public async Task HealthReturnsExpectedContract()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/health", CancellationToken.None);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>(CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(body);
        Assert.Equal("healthy", body.Status);
        Assert.Equal("Dhanvi API", body.Application);
        Assert.True(response.Headers.Contains("X-Correlation-ID"));
    }

    private sealed record HealthResponse(string Status, string Application);
}
