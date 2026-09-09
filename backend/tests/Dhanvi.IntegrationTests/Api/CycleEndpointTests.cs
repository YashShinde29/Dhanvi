using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
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

public sealed partial class CycleEndpointTests(CycleApiFixture fixture) : IClassFixture<CycleApiFixture>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper) } };
    private sealed record Scenario(Guid GroupId, Guid OwnerId, Guid[] MemberIds, string Scope);
    private async Task<Scenario> Seed(int count = 20, GroupType type = GroupType.Random, bool organizer = false, bool reserved = false, bool ready = true, AuctionGroupRules? auctionRules = null)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var identities = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var now = fixture.Clock.UtcNow;
        var owner = NewUser(now); identities.Users.Add(owner); var users = Enumerable.Range(0, count).Select(_ => NewUser(now)).ToArray();
        if (reserved) users[0] = owner;
        identities.Users.AddRange(users.Where(u => u.Id != owner.Id)); await identities.SaveChangesAsync();
        if (organizer)
        {
            var organizers = scope.ServiceProvider.GetRequiredService<OrganizerDbContext>(); var profile = OrganizerProfile.CreateForApplication(owner.Id, now); profile.Approve(owner.Id, now); organizers.OrganizerProfiles.Add(profile); await organizers.SaveChangesAsync();
        }
        var group = Group.Create("Cycle integration group", "", organizer ? GroupCreatorType.Organizer : GroupCreatorType.Platform, owner.Id, new(type, 50000, count, reserved, reserved, 1, 2, 2, DateOnly.FromDateTime(now.UtcDateTime).AddMonths(1), auctionRules), organizer, now);
        var rules = group.Publish(organizer, now); db.Groups.Add(group); db.RuleVersions.Add(rules);
        for (var i = 0; i < count; i++)
        {
            var member = GroupMembership.Apply(group.Id, users[i].Id, now); member.Approve(reserved && i == 0 ? 1 : group.ApproveMember(now), now); db.Memberships.Add(member); db.TermsAcceptances.Add(member.Accept(rules, now));
        }
        if (ready) group.ConfirmReady(true, count, organizer, now);
        await db.SaveChangesAsync(); return new(group.Id, owner.Id, users.Select(u => u.Id).ToArray(), organizer ? "organizer" : "admin");
    }
    private static User NewUser(DateTimeOffset now) { var email = $"{Guid.NewGuid():N}@cycle.test"; return User.Create("Cycle", "Member", email, email.ToUpperInvariant(), null, now); }
    private HttpClient Client(Guid userId, string role = "USER")
    {
        using var scope = fixture.Factory.Services.CreateScope(); var jwt = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value;
        var token = new JwtSecurityToken(jwt.Issuer, jwt.Audience, [new(ClaimTypes.NameIdentifier, userId.ToString()), new(ClaimTypes.Role, role)], DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(30), new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)), SecurityAlgorithms.HmacSha256));
        var client = fixture.Factory.CreateClient(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(token)); return client;
    }
    private HttpClient Owner(Scenario s) => Client(s.OwnerId, s.Scope == "admin" ? "ADMIN" : "ORGANIZER");
    private static async Task<IReadOnlyList<CycleDetails>> Activate(HttpClient client, Scenario s) { using var response = await client.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<List<CycleDetails>>(Json))!; }
    private static async Task<List<ContributionDetails>> Rows(HttpClient client, Scenario s, Guid cycleId) => (await client.GetFromJsonAsync<List<ContributionDetails>>($"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{cycleId}/contributions", Json))!;
    private static Task<HttpResponseMessage> Operation(HttpClient client, Scenario s, ContributionDetails c, object body, string key, bool reverse = false)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{c.CycleId}/contributions/{c.Id}/{(reverse ? "reverse" : "record")}") { Content = JsonContent.Create(body, options: Json) }; request.Headers.Add("Idempotency-Key", key); return Send(client, request);
    }
    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpRequestMessage request) { using (request) return await client.SendAsync(request); }
    private static async Task<ContributionOperationResult> Result(Task<HttpResponseMessage> task) { using var response = await task; Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<ContributionOperationResult>(Json))!; }

    [Theory] [InlineData(20, false, GroupType.Random, false)] [InlineData(50, false, GroupType.Auction, false)] [InlineData(20, true, GroupType.Random, true)] [InlineData(20, true, GroupType.Auction, true)]
    public async Task ActivationAtomicallyCreatesScheduleAndEveryObligation(int count, bool organizer, GroupType type, bool reserved)
    {
        var s = await Seed(count, type, organizer, reserved); using var owner = Owner(s); var cycles = await Activate(owner, s);
        Assert.Equal(count, cycles.Count); Assert.Equal(Enumerable.Range(1, count), cycles.Select(c => c.CycleNumber)); Assert.Equal(CycleStatus.CollectingContributions, cycles[0].Status); Assert.All(cycles.Skip(1), c => Assert.Equal(CycleStatus.Upcoming, c.Status));
        Assert.Equal(reserved ? SelectionMethod.OrganizerReserved : type == GroupType.Random ? SelectionMethod.Random : SelectionMethod.Auction, cycles[0].SelectionMethod);
        Assert.All(cycles.Skip(1), c => Assert.Equal(type == GroupType.Random ? SelectionMethod.Random : SelectionMethod.Auction, c.SelectionMethod));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.Equal(count * count, await db.Contributions.CountAsync(c => c.GroupId == s.GroupId)); Assert.All(await db.Contributions.Where(c => c.GroupId == s.GroupId).ToListAsync(), c => Assert.Equal(50000m / count, c.ExpectedAmount));
        Assert.Equal(count, await db.Memberships.CountAsync(m => m.GroupId == s.GroupId && m.Status == MembershipStatus.Active));
        Assert.Equal(1, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "GROUP_ACTIVATED"));
        var repeated = await Activate(owner, s); Assert.Equal(cycles.Select(c => c.Id), repeated.Select(c => c.Id));
    }
    [Fact] public async Task ConcurrentActivationDoesNotDuplicateSchedule()
    {
        var s = await Seed(); using var owner = Owner(s); var results = await Task.WhenAll(Activate(owner, s), Activate(owner, s)); Assert.Equal(results[0].Select(c => c.Id), results[1].Select(c => c.Id));
    }
    [Fact] public async Task ActivationRejectsWrongOwnerAndNotReadyGroups()
    {
        var s = await Seed(organizer: true, ready: false); using var owner = Owner(s); using var member = Client(s.MemberIds[0], "ORGANIZER");
        using var denied = await member.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var unready = await owner.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.Conflict, unready.StatusCode);
    }
    [Theory] [InlineData(OrganizerStatus.Pending)] [InlineData(OrganizerStatus.Suspended)]
    public async Task ActivationRechecksOrganizerStatus(OrganizerStatus status)
    {
        var s = await Seed(organizer: true); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<OrganizerDbContext>(); var organizer = await db.OrganizerProfiles.SingleAsync(o => o.UserId == s.OwnerId);
        if (status == OrganizerStatus.Pending) organizer.MarkApplicationPending(fixture.Clock.UtcNow); else organizer.Suspend(fixture.Clock.UtcNow); await db.SaveChangesAsync();
        using var owner = Owner(s); using var response = await owner.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Fact] public async Task PersonalHistoryAndCycleDetailsArePrivate()
    {
        var s = await Seed(organizer: true); using var owner = Owner(s); var cycles = await Activate(owner, s); using var member = Client(s.MemberIds[0]);
        var mine = await member.GetFromJsonAsync<ContributionPage>("/api/v1/me/contributions?pageSize=100", Json); Assert.Equal(20, mine!.TotalCount); Assert.Single(mine.Items.Select(c => c.MembershipId).Distinct()); Assert.All(mine.Items, c => { Assert.Null(c.MemberName); Assert.Empty(c.Entries); });
        var schedule = await member.GetFromJsonAsync<List<CycleDetails>>($"/api/v1/groups/{s.GroupId}/cycles", Json); Assert.Equal(20, schedule!.Count);
        using var denied = await member.GetAsync($"/api/v1/organizer/groups/{s.GroupId}/cycles/{cycles[0].Id}/contributions"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var unrelated = await Seed(organizer: true); using var stranger = Owner(unrelated); using var unrelatedHistory = await stranger.GetAsync($"/api/v1/groups/{s.GroupId}/my-contributions"); Assert.Equal(HttpStatusCode.Forbidden, unrelatedHistory.StatusCode);
        using var unrelatedCycle = await stranger.GetAsync($"/api/v1/organizer/groups/{s.GroupId}/cycles/{cycles[0].Id}/contributions"); Assert.Equal(HttpStatusCode.Forbidden, unrelatedCycle.StatusCode);
        var row = (await Rows(owner, s, cycles[0].Id))[0];
        using var unauthorizedRecord = await Operation(stranger, s, row, new RecordContributionRequest(2500, "unauthorized", null), "denied"); Assert.Equal(HttpStatusCode.Forbidden, unauthorizedRecord.StatusCode);
        using var mismatchedCycle = await Operation(owner, s, row with { CycleId = cycles[1].Id }, new RecordContributionRequest(2500, "wrong-cycle", null), "wrong-cycle"); Assert.Equal(HttpStatusCode.NotFound, mismatchedCycle.StatusCode);
        var upcoming = (await Rows(owner, s, cycles[1].Id))[0]; using var futureRecord = await Operation(owner, s, upcoming, new RecordContributionRequest(2500, "too-early", null), "too-early"); Assert.Equal(HttpStatusCode.Conflict, futureRecord.StatusCode);
    }
    [Fact] public async Task FullAndPartialRecordingReplaysAndRejectsChangedKeys()
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); var row = (await Rows(owner, s, cycles[0].Id))[0];
        var request = new RecordContributionRequest(500, "partial", "manual test"); var first = await Result(Operation(owner, s, row, request, "key1")); var replay = await Result(Operation(owner, s, row, request, "key1")); Assert.Equal(first.Entry.Id, replay.Entry.Id); Assert.True(replay.Replayed);
        var after = (await Rows(owner, s, cycles[0].Id))[0]; Assert.Equal(500, after.RecordedAmount); Assert.Equal(ContributionStatus.Partial, after.Status);
        using var changed = await Operation(owner, s, row, request with { Amount = 600 }, "key1"); Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        using var duplicateReference = await Operation(owner, s, row, request, "different-key"); Assert.Equal(HttpStatusCode.Conflict, duplicateReference.StatusCode);
        await Result(Operation(owner, s, row, new RecordContributionRequest(2000, "remainder", null), "key2")); after = (await Rows(owner, s, cycles[0].Id))[0]; Assert.Equal(ContributionStatus.Recorded, after.Status); Assert.Equal(2500, after.RecordedAmount); Assert.Equal(2, after.Entries.Count);
        using var excess = await Operation(owner, s, row, new RecordContributionRequest(1, "extra", null), "key3"); Assert.Equal(HttpStatusCode.Conflict, excess.StatusCode);
    }
    [Theory] [InlineData(true)] [InlineData(false)] public async Task ConcurrentRecordingCannotOverRecord(bool sameKey)
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); var row = (await Rows(owner, s, cycles[0].Id))[0];
        var responses = await Task.WhenAll(Operation(owner, s, row, new RecordContributionRequest(2500, "one", null), "key"), Operation(owner, s, row, new RecordContributionRequest(2500, sameKey ? "one" : "two", null), sameKey ? "key" : "other"));
        Assert.Equal(sameKey ? 2 : 1, responses.Count(r => r.IsSuccessStatusCode)); foreach (var response in responses) response.Dispose();
        var after = (await Rows(owner, s, cycles[0].Id))[0]; Assert.Equal(2500, after.RecordedAmount); Assert.Single(after.Entries);
    }
    [Fact] public async Task FinalRecordSetsReadinessAndReversalReopensSameCycle()
    {
        var s = await Seed(organizer: true, reserved: true); using var owner = Owner(s); var cycles = await Activate(owner, s); var rows = await Rows(owner, s, cycles[0].Id); ContributionOperationResult? first = null;
        for (var i = 0; i < rows.Count; i++) { var r = await Result(Operation(owner, s, rows[i], new RecordContributionRequest(2500, $"record-{i}", null), $"key-{i}")); first ??= r; }
        var complete = (await owner.GetFromJsonAsync<List<CycleDetails>>($"/api/v1/groups/{s.GroupId}/cycles", Json))!; Assert.Equal(CycleStatus.ReadyForSelection, complete[0].Status); Assert.Equal(50000, complete[0].RecordedContributionAmount); Assert.NotNull(complete[0].ContributionsCompletedAt); Assert.NotNull(complete[0].ReadyForSelectionAt); Assert.Equal(CycleStatus.Upcoming, complete[1].Status);
        var completedReplay = await Result(Operation(owner, s, rows[^1], new RecordContributionRequest(2500, $"record-{rows.Count - 1}", null), $"key-{rows.Count - 1}")); Assert.True(completedReplay.Replayed);
        var reverseRequest = new ReverseContributionRequest(first!.Entry.Id, "Incorrect manual entry"); await Result(Operation(owner, s, rows[0], reverseRequest, "reverse", true)); var replay = await Result(Operation(owner, s, rows[0], reverseRequest, "reverse", true)); Assert.True(replay.Replayed);
        var after = (await Rows(owner, s, cycles[0].Id))[0]; Assert.Equal(0, after.RecordedAmount); Assert.Equal(ContributionStatus.Reversed, after.Status); Assert.Equal(2, after.Entries.Count);
        var reopened = (await owner.GetFromJsonAsync<List<CycleDetails>>($"/api/v1/groups/{s.GroupId}/cycles", Json))!; Assert.Equal(CycleStatus.CollectingContributions, reopened[0].Status); Assert.Equal(47500, reopened[0].RecordedContributionAmount); Assert.Equal(CycleStatus.Upcoming, reopened[1].Status);
        using var duplicateReverse = await Operation(owner, s, rows[0], reverseRequest, "reverse-again", true); Assert.Equal(HttpStatusCode.Conflict, duplicateReverse.StatusCode);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); Assert.Equal(1, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "CYCLE_READY_FOR_SELECTION")); Assert.Equal(20, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "CONTRIBUTION_RECORDED"));
    }
    [Fact] public async Task SuspendedActiveGroupPreservesScheduleAndBlocksRecords()
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); var row = (await Rows(owner, s, cycles[0].Id))[0]; using var suspended = await owner.PostAsJsonAsync($"/api/v1/admin/groups/{s.GroupId}/suspend", new { reason = "Operational review" }); suspended.EnsureSuccessStatusCode();
        using var blocked = await Operation(owner, s, row, new RecordContributionRequest(2500, "manual", null), "key"); Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode); Assert.Equal(20, (await owner.GetFromJsonAsync<List<CycleDetails>>($"/api/v1/admin/groups/{s.GroupId}/cycles", Json))!.Count);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); Assert.True(await db.AuditEvents.AnyAsync(e => e.GroupId == s.GroupId && e.Action == "GROUP_SUSPENDED_DURING_ACTIVE_CYCLE"));
    }
    [Fact] public async Task OverdueUsesBusinessDateAndOnlyOpenCycleShortfalls()
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); var rows = await Rows(owner, s, cycles[0].Id); await Result(Operation(owner, s, rows[0], new RecordContributionRequest(2500, "full", null), "key"));
        var before = fixture.Clock.UtcNow;
        try
        {
            fixture.Clock.UtcNow = new DateTimeOffset(cycles[0].ContributionDueDate.ToDateTime(new TimeOnly(18, 30)), TimeSpan.Zero);
            using var response = await owner.PostAsJsonAsync($"/api/v1/admin/groups/{s.GroupId}/mark-overdue", new { }); response.EnsureSuccessStatusCode();
            rows = await Rows(owner, s, cycles[0].Id); Assert.Equal(19, rows.Count(c => c.Status == ContributionStatus.Overdue)); Assert.Equal(ContributionStatus.Recorded, rows[0].Status);
            var future = await Rows(owner, s, cycles[1].Id); Assert.All(future, c => Assert.Equal(ContributionStatus.Pending, c.Status));
        }
        finally { fixture.Clock.UtcNow = before; }
    }
    [Fact] public async Task InvalidPoolAndTermsAreRevalidatedAtActivation()
    {
        var s = await Seed(); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        // GroupValue's independent stored column can expose legacy inconsistency without disabling constraints.
        await db.Groups.Where(g => g.Id == s.GroupId).ExecuteUpdateAsync(setters => setters.SetProperty(g => g.GroupValue, 49999m));
        using var owner = Owner(s); using var response = await owner.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Empty(await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId).ToListAsync());
        var other = await Seed(); await db.TermsAcceptances.Where(a => db.Memberships.Any(m => m.GroupId == other.GroupId && m.Id == a.MembershipId)).ExecuteDeleteAsync(); using var otherOwner = Owner(other); using var noTerms = await otherOwner.PostAsJsonAsync($"/api/v1/groups/{other.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.Conflict, noTerms.StatusCode);
    }
    [Fact] public async Task DatabaseFailureRollsBackActivationCompletely()
    {
        var s = await Seed(); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var function = $"fail_activation_{s.GroupId:N}";
        var sql = $$"""
            CREATE FUNCTION groups.{{function}}() RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN IF NEW."GroupId" = '{{s.GroupId}}'::uuid THEN RAISE EXCEPTION 'Injected obligation failure'; END IF; RETURN NEW; END; $body$;
            CREATE TRIGGER {{function}} BEFORE INSERT ON groups."Contributions" FOR EACH ROW EXECUTE FUNCTION groups.{{function}}();
            """;
        await db.Database.ExecuteSqlRawAsync(sql);
        try
        {
            using var owner = Owner(s); using var response = await owner.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/activate", new { }); Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Equal(GroupStatus.ReadyToStart, (await db.Groups.SingleAsync(g => g.Id == s.GroupId)).Status); Assert.False(await db.MonthlyCycles.AnyAsync(c => c.GroupId == s.GroupId)); Assert.False(await db.Contributions.AnyAsync(c => c.GroupId == s.GroupId)); Assert.False(await db.AuditEvents.AnyAsync(a => a.GroupId == s.GroupId && a.Action == "GROUP_ACTIVATED"));
        }
        finally { var cleanupSql = $"DROP TRIGGER {function} ON groups.\"Contributions\"; DROP FUNCTION groups.{function}();"; await db.Database.ExecuteSqlRawAsync(cleanupSql); }
    }
    [Fact] public async Task DatabaseProtectsAppendOnlyHistory()
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); var row = (await Rows(owner, s, cycles[0].Id))[0]; await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "manual", null), "key"));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.ContributionEntries.Where(e => e.ContributionId == row.Id).ExecuteDeleteAsync()); Assert.Single(await db.ContributionEntries.Where(e => e.ContributionId == row.Id).ToListAsync());
    }
}
