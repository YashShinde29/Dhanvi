using System.Net;

namespace Dhanvi.IntegrationTests.Api;

public sealed class CorsPolicyTests(DhanviApiFactory factory) : IClassFixture<DhanviApiFactory>
{
    [Theory]
    [InlineData("http://localhost:3000")]
    [InlineData("http://localhost:3001")]
    public async Task AllowsBothWebAppOriginsWithCredentials(string origin)
    {
        using var client = factory.CreateClient();
        using var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/login");
        preflight.Headers.Add("Origin", origin);
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        preflight.Headers.Add("Access-Control-Request-Headers", "content-type");
        using var response = await client.SendAsync(preflight, CancellationToken.None);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Equal("true", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Credentials")));
    }

    [Theory]
    [InlineData("http://localhost:3002")]
    [InlineData("https://evil.example")]
    public async Task RejectsUnknownOrigins(string origin)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", origin);
        using var response = await client.SendAsync(request, CancellationToken.None);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
