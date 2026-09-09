using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Infrastructure.Security;
using Dhanvi.Modules.Organizers.Domain;
using Dhanvi.Modules.Organizers.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
namespace Dhanvi.IntegrationTests.Api;

public sealed class GroupEndpointTests(IdentityApiFixture fixture) : IClassFixture<IdentityApiFixture>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper) } };
    private static SaveGroupRequest Request(GroupType type = GroupType.Random, bool participates = false) => new("Integration group " + Guid.NewGuid(), "Test group", type, 50000, 20, participates, participates, 1, 2, 2, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(3)));
    [Theory] [InlineData(GroupType.Random)] [InlineData(GroupType.Auction)]
    public async Task OrganizerCreatesPublishesAndAcceptsOwnRules(GroupType type)
    {
        using var organizer = await Client("ORGANIZER", OrganizerStatus.Approved);
        var g = await Create(organizer, "organizer", Request(type, true));
        Assert.Equal(1, g.CurrentMemberCount); Assert.Equal(19, g.AvailableSlots); Assert.Equal(SelectionMethod.OrganizerReserved, g.FirstCycleSelectionMethod);
        Assert.NotNull(g.MyMembership); Assert.Null(g.MyMembership.TermsAcceptedAt);
        await Success(organizer.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/publish", new { }));
        g = await Get(organizer, g.Id); Assert.Equal(GroupStatus.Recruiting, g.Status);
        await Accept(organizer, g); var accepted = await Get(organizer, g.Id);
        Assert.Equal(g.CurrentRules!.Id, accepted.MyMembership!.TermsVersionId);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var stored = await db.TermsAcceptances.SingleAsync(a => a.MembershipId == g.MyMembership!.Id);
        Assert.Equal(g.CurrentRules.RulesHash, stored.RulesHash);
    }
    [Theory] [InlineData("USER", null)] [InlineData("ORGANIZER", OrganizerStatus.Pending)] [InlineData("ORGANIZER", OrganizerStatus.Suspended)] [InlineData("ORGANIZER", OrganizerStatus.Rejected)]
    public async Task UnapprovedUsersCannotCreate(string role, OrganizerStatus? status)
    {
        using var user = await Client(role, status); using var response = await user.PostAsJsonAsync("/api/v1/organizer/groups", Request(), Json); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Theory] [InlineData(GroupType.Random)] [InlineData(GroupType.Auction)]
    public async Task PlatformCreationAndPublicDraftPrivacy(GroupType type)
    {
        using var admin = await Client("ADMIN"); using var anonymous = fixture.Factory.CreateClient();
        var g = await Create(admin, "admin", Request(type)); Assert.Equal(GroupCreatorType.Platform, g.CreatorType); Assert.Null(g.Organizer);
        using var detail = await anonymous.GetAsync($"/api/v1/groups/{g.Id}"); Assert.Equal(HttpStatusCode.NotFound, detail.StatusCode);
        var list = await anonymous.GetFromJsonAsync<GroupPage>($"/api/v1/groups?search={Uri.EscapeDataString(g.Name)}", Json); Assert.Empty(list!.Items);
        await Success(admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/publish", new { }));
        list = await anonymous.GetFromJsonAsync<GroupPage>($"/api/v1/groups?groupType={type.ToString().ToUpperInvariant()}&creatorType=PLATFORM&search={Uri.EscapeDataString(g.Name)}", Json); Assert.Single(list!.Items);
    }
    [Fact]
    public async Task ApplicationsEnforceOwnershipDuplicatesAndContactPrivacy()
    {
        using var owner = await Client("ORGANIZER", OrganizerStatus.Approved); using var other = await Client("ORGANIZER", OrganizerStatus.Approved); using var member = await Client("USER");
        var g = await Create(owner, "organizer", Request());
        using var draftApply = await member.PostAsJsonAsync($"/api/v1/groups/{g.Id}/applications", new { }); Assert.Equal(HttpStatusCode.Conflict, draftApply.StatusCode);
        await Success(owner.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/publish", new { }));
        using var contact = await member.GetAsync($"/api/v1/groups/{g.Id}/organizer/contact"); Assert.Equal(HttpStatusCode.Forbidden, contact.StatusCode);
        await Success(member.PostAsJsonAsync($"/api/v1/groups/{g.Id}/applications", new { }));
        using var duplicate = await member.PostAsJsonAsync($"/api/v1/groups/{g.Id}/applications", new { }); Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        var applied = await Get(member, g.Id); var mid = applied.MyMembership!.Id;
        using var stolen = await other.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/applications/{mid}/approve", new { }); Assert.Equal(HttpStatusCode.Forbidden, stolen.StatusCode);
        await Success(owner.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/applications/{mid}/approve", new { }));
        using var approvedContact = await member.GetAsync($"/api/v1/groups/{g.Id}/organizer/contact"); Assert.Equal(HttpStatusCode.OK, approvedContact.StatusCode);
        var publicBody = await other.GetStringAsync($"/api/v1/groups/{g.Id}"); Assert.DoesNotContain("@test.local", publicBody); Assert.DoesNotContain("phone", publicBody, StringComparison.OrdinalIgnoreCase);
        using var update = await owner.PutAsJsonAsync($"/api/v1/organizer/groups/{g.Id}", Request() with { GroupValue = 100000 }, Json); Assert.Equal(HttpStatusCode.Conflict, update.StatusCode);
        await Success(owner.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/cancel", new { reason = "Cancelled test group" }));
        using var cancelled = await other.PostAsJsonAsync($"/api/v1/groups/{g.Id}/applications", new { }); Assert.Equal(HttpStatusCode.Conflict, cancelled.StatusCode);
    }
    [Fact]
    public async Task ConcurrentFinalApprovalsAllowExactlyOneAndReadinessRequiresAllTerms()
    {
        using var admin = await Client("ADMIN"); var g = await Create(admin, "admin", Request());
        await Success(admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/publish", new { }));
        var clients = new List<HttpClient>(); var memberships = new List<Guid>();
        try
        {
            for (var i = 0; i < 21; i++)
            {
                var user = await Client("USER"); clients.Add(user); await Success(user.PostAsJsonAsync($"/api/v1/groups/{g.Id}/applications", new { })); memberships.Add((await Get(user, g.Id)).MyMembership!.Id);
            }
            for (var i = 0; i < 19; i++) await Success(admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/applications/{memberships[i]}/approve", new { }));
            var approvals = await Task.WhenAll(memberships.Skip(19).Select(mid => admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/applications/{mid}/approve", new { })));
            Assert.Single(approvals, r => r.StatusCode == HttpStatusCode.NoContent); Assert.Single(approvals, r => r.StatusCode == HttpStatusCode.Conflict); foreach (var response in approvals) response.Dispose();
            g = await Get(admin, g.Id); Assert.Equal(20, g.CurrentMemberCount); Assert.Equal(GroupStatus.FullySubscribed, g.Status);
            using var premature = await admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/confirm-ready", new { }); Assert.Equal(HttpStatusCode.Conflict, premature.StatusCode);
            foreach (var user in clients) { var detail = await Get(user, g.Id); if (detail.MyMembership!.Status == MembershipStatus.Approved) await Accept(user, detail); }
            await Success(admin.PostAsJsonAsync($"/api/v1/admin/groups/{g.Id}/confirm-ready", new { })); Assert.Equal(GroupStatus.ReadyToStart, (await Get(admin, g.Id)).Status);
            using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            var slots = await db.Memberships.Where(m => m.GroupId == g.Id && m.SlotNumber != null).Select(m => m.SlotNumber).ToListAsync(); Assert.Equal(20, slots.Distinct().Count());
            Assert.Equal(1, await db.AuditEvents.CountAsync(a => a.GroupId == g.Id && a.Action == "GROUP_FULLY_SUBSCRIBED"));
        }
        finally { foreach (var user in clients) user.Dispose(); }
    }
    [Fact]
    public async Task StaleTermsAndRepeatedReviewAreRejected()
    {
        using var owner = await Client("ORGANIZER", OrganizerStatus.Approved); var g = await Create(owner, "organizer", Request(participates: true));
        await Success(owner.PostAsJsonAsync($"/api/v1/organizer/groups/{g.Id}/publish", new { })); g = await Get(owner, g.Id);
        using var stale = await owner.PostAsJsonAsync($"/api/v1/groups/{g.Id}/accept-terms", new { groupRuleVersionId = Guid.NewGuid(), rulesHash = "old" }); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        await Accept(owner, g); using var duplicate = await owner.PostAsJsonAsync($"/api/v1/groups/{g.Id}/accept-terms", new { groupRuleVersionId = g.CurrentRules!.Id, rulesHash = g.CurrentRules.RulesHash }); Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }
    private async Task<HttpClient> Client(string role, OrganizerStatus? status = null)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); var email = $"{Guid.NewGuid():N}@test.local";
        var user = User.Create("Group", "Tester", email, email.ToUpperInvariant(), "9999999999", DateTimeOffset.UtcNow); db.Users.Add(user); await db.SaveChangesAsync();
        if (status is { } state)
        {
            var organizers = scope.ServiceProvider.GetRequiredService<OrganizerDbContext>(); var profile = OrganizerProfile.CreateForApplication(user.Id, DateTimeOffset.UtcNow);
            if (state == OrganizerStatus.Approved) profile.Approve(user.Id, DateTimeOffset.UtcNow); else if (state == OrganizerStatus.Suspended) profile.Suspend(DateTimeOffset.UtcNow); else if (state == OrganizerStatus.Rejected) profile.Reject(DateTimeOffset.UtcNow);
            organizers.OrganizerProfiles.Add(profile); await organizers.SaveChangesAsync();
        }
        var jwt = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        var token = new JwtSecurityToken(jwt.Issuer, jwt.Audience, [new(ClaimTypes.NameIdentifier, user.Id.ToString()), new(ClaimTypes.Role, role)], DateTime.UtcNow, DateTime.UtcNow.AddMinutes(15), new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)), SecurityAlgorithms.HmacSha256));
        var client = fixture.Factory.CreateClient(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(token)); return client;
    }
    private static async Task<GroupDetails> Create(HttpClient client, string scope, SaveGroupRequest request) { using var response = await client.PostAsJsonAsync($"/api/v1/{scope}/groups", request, Json); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<GroupDetails>(Json))!; }
    private static async Task<GroupDetails> Get(HttpClient client, Guid id) => (await client.GetFromJsonAsync<GroupDetails>($"/api/v1/groups/{id}", Json))!;
    private static Task Accept(HttpClient client, GroupDetails g) => Success(client.PostAsJsonAsync($"/api/v1/groups/{g.Id}/accept-terms", new { groupRuleVersionId = g.CurrentRules!.Id, rulesHash = g.CurrentRules.RulesHash }));
    private static async Task Success(Task<HttpResponseMessage> task) { using var response = await task; Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); }
}
