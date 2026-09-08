using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dhanvi.IntegrationTests.Api;

public sealed class IdentityAndOrganizerEndpointTests(IdentityApiFixture fixture) : IClassFixture<IdentityApiFixture>
{
    private const string Password = "StrongPassword@123";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    [Trait("Category", "Integration")]
    public async Task RegistrationSucceedsAndDoesNotExposePasswordHash()
    {
        using var client = fixture.Factory.CreateClient();
        var email = UniqueEmail();

        var response = await RegisterAsync(client, email);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"roles\":[\"USER\"]", body);
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hash", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task DuplicateEmailRegistrationFails()
    {
        using var client = fixture.Factory.CreateClient();
        var email = UniqueEmail();
        (await RegisterAsync(client, email)).EnsureSuccessStatusCode();

        var duplicate = await RegisterAsync(client, email.ToUpperInvariant());

        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task LoginAcceptsCorrectAndRejectsIncorrectPassword()
    {
        using var client = fixture.Factory.CreateClient();
        var email = UniqueEmail();
        (await RegisterAsync(client, email)).EnsureSuccessStatusCode();

        var valid = await LoginAsync(client, email, Password);
        var invalid = await LoginAsync(client, email, "IncorrectPassword@123");

        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        var invalidBody = await invalid.Content.ReadAsStringAsync();
        Assert.DoesNotContain(email, invalidBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task CurrentUserRequiresAuthenticationAndReturnsAuthenticatedUser()
    {
        using var client = fixture.Factory.CreateClient();
        var unauthorized = await client.GetAsync("/api/v1/users/me");
        var auth = await RegisterAndLoginAsync(client);

        using var authorizedRequest = Authorized(HttpMethod.Get, "/api/v1/users/me", auth.AccessToken);
        var authorized = await client.SendAsync(authorizedRequest);
        var user = await authorized.Content.ReadFromJsonAsync<CurrentUser>(JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Equal(HttpStatusCode.OK, authorized.StatusCode);
        Assert.NotNull(user);
        Assert.Equal(auth.Email, user.Email);
        Assert.Contains("USER", user.Roles);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task RefreshRotatesTokenAndRevokedTokenCannotBeReused()
    {
        using var client = fixture.Factory.CreateClient();
        var auth = await RegisterAndLoginAsync(client);

        var firstRefresh = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = auth.RefreshToken });
        var rotated = await ReadAuthenticationAsync(firstRefresh);
        var reuse = await client.PostAsJsonAsync("/api/v1/auth/refresh", new { refreshToken = auth.RefreshToken });

        Assert.Equal(HttpStatusCode.OK, firstRefresh.StatusCode);
        Assert.NotEqual(auth.RefreshToken, rotated.RefreshToken);
        Assert.False(string.IsNullOrWhiteSpace(rotated.AccessToken));
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task PasswordResetTokenCannotBeReused()
    {
        using var client = fixture.Factory.CreateClient();
        var email = UniqueEmail();
        (await RegisterAsync(client, email)).EnsureSuccessStatusCode();
        var forgot = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        forgot.EnsureSuccessStatusCode();
        var token = fixture.EmailSender.GetResetToken(email);

        var first = await client.PostAsJsonAsync("/api/v1/auth/reset-password", new { token, newPassword = "NewStrongPassword@123" });
        var second = await client.PostAsJsonAsync("/api/v1/auth/reset-password", new { token, newPassword = "AnotherPassword@123" });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task UserCanApplyButCannotCreateDuplicateActiveApplication()
    {
        using var client = fixture.Factory.CreateClient();
        var auth = await RegisterAndLoginAsync(client);

        var first = await SendJsonAsync(client, HttpMethod.Post, "/api/v1/organizers/apply", OrganizerApplicationInput(), auth.AccessToken);
        var duplicate = await SendJsonAsync(client, HttpMethod.Post, "/api/v1/organizers/apply", OrganizerApplicationInput(), auth.AccessToken);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task NormalUserCannotApproveOrganizerApplication()
    {
        using var client = fixture.Factory.CreateClient();
        var auth = await RegisterAndLoginAsync(client);
        var application = await ApplyAsync(client, auth.AccessToken);

        using var request = Authorized(HttpMethod.Post, $"/api/v1/admin/organizer-applications/{application.Id}/approve", auth.AccessToken);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task AdminApprovalAssignsOrganizerRoleAndCreatesAuditEvent()
    {
        using var client = fixture.Factory.CreateClient();
        var applicant = await RegisterAndLoginAsync(client);
        var application = await ApplyAsync(client, applicant.AccessToken);
        var admin = await LoginAndReadAsync(client, "admin@dhanvi.test", "AdminPassword@123");

        using var approveRequest = Authorized(HttpMethod.Post, $"/api/v1/admin/organizer-applications/{application.Id}/approve", admin.AccessToken);
        var approval = await client.SendAsync(approveRequest);
        using var meRequest = Authorized(HttpMethod.Get, "/api/v1/users/me", applicant.AccessToken);
        var meResponse = await client.SendAsync(meRequest);
        var meBody = await meResponse.Content.ReadAsStringAsync();
        Assert.True(meResponse.IsSuccessStatusCode, meBody);
        var me = await meResponse.Content.ReadFromJsonAsync<CurrentUser>(JsonOptions);

        Assert.Equal(HttpStatusCode.NoContent, approval.StatusCode);
        Assert.NotNull(me);
        Assert.Contains("ORGANIZER", me.Roles);
        Assert.Equal("APPROVED", me.OrganizerStatus);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var auditDb = scope.ServiceProvider.GetRequiredService<AuditDbContext>();
        Assert.True(await auditDb.AuditLogs.AnyAsync(log => log.Action == "ORGANIZER_APPLICATION_APPROVED" && log.EntityId == application.Id.ToString()));
    }

    [Fact]
    [Trait("Category", "Integration")]
    public async Task AdminRejectionRequiresReason()
    {
        using var client = fixture.Factory.CreateClient();
        var applicant = await RegisterAndLoginAsync(client);
        var application = await ApplyAsync(client, applicant.AccessToken);
        var admin = await LoginAndReadAsync(client, "admin@dhanvi.test", "AdminPassword@123");

        var response = await SendJsonAsync(client, HttpMethod.Post, $"/api/v1/admin/organizer-applications/{application.Id}/reject", new { reason = "" }, admin.AccessToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static async Task<HttpResponseMessage> RegisterAsync(HttpClient client, string email) => await client.PostAsJsonAsync("/api/v1/auth/register", new
    {
        firstName = "Yash", lastName = "Shinde", email, phoneNumber = "+919876543210", password = Password,
    });

    private static async Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string password) =>
        await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });

    private static async Task<TestAuthentication> RegisterAndLoginAsync(HttpClient client)
    {
        var email = UniqueEmail();
        (await RegisterAsync(client, email)).EnsureSuccessStatusCode();
        var auth = await LoginAndReadAsync(client, email, Password);
        return auth with { Email = email };
    }

    private static async Task<TestAuthentication> LoginAndReadAsync(HttpClient client, string email, string password)
    {
        var response = await LoginAsync(client, email, password);
        response.EnsureSuccessStatusCode();
        var auth = await ReadAuthenticationAsync(response);
        return auth with { Email = email };
    }

    private static async Task<TestAuthentication> ReadAuthenticationAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<TestAuthentication>(JsonOptions) ?? throw new InvalidOperationException("Authentication response was empty.");

    private static async Task<OrganizerApplication> ApplyAsync(HttpClient client, string accessToken)
    {
        var response = await SendJsonAsync(client, HttpMethod.Post, "/api/v1/organizers/apply", OrganizerApplicationInput(), accessToken);
        response.EnsureSuccessStatusCode();
        var status = await response.Content.ReadFromJsonAsync<OrganizerStatus>(JsonOptions) ?? throw new InvalidOperationException("Organizer response was empty.");
        return status.Application ?? throw new InvalidOperationException("Organizer application was empty.");
    }

    private static object OrganizerApplicationInput() => new
    {
        address = "123 Test Street", city = "Pune", state = "Maharashtra", postalCode = "411001",
        reasonForBecomingOrganizer = "I want to organize a savings group for people I know.", experienceDescription = "Community coordination",
    };

    private static async Task<HttpResponseMessage> SendJsonAsync(HttpClient client, HttpMethod method, string url, object body, string accessToken)
    {
        using var request = Authorized(method, url, accessToken);
        request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }

    private static HttpRequestMessage Authorized(HttpMethod method, string url, string token)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static string UniqueEmail() => $"user-{Guid.NewGuid():N}@dhanvi.test";

    private sealed record TestAuthentication(string AccessToken, string RefreshToken, string Email = "");
    private sealed record CurrentUser(string Email, string[] Roles, string OrganizerStatus);
    private sealed record OrganizerStatus(string Status, OrganizerApplication? Application);
    private sealed record OrganizerApplication(Guid Id);
}
