using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.Modules.RandomDraws.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Dhanvi.IntegrationTests.Api;

public sealed partial class CycleEndpointTests
{
    private async Task<(Scenario Scenario, CycleDetails Cycle)> SelectionReady(bool organizer = false, bool reserved = false, GroupType type = GroupType.Random)
    {
        var s = await Seed(organizer: organizer, reserved: reserved, type: type); using var owner = Owner(s); var cycles = await Activate(owner, s);
        foreach (var row in await Rows(owner, s, cycles[0].Id)) await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "selection-ready", null), row.Id.ToString()));
        return (s, cycles[0]);
    }
    private static Task<HttpResponseMessage> Select(HttpClient client, Scenario s, Guid cycleId) => client.PostAsJsonAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycleId}/selection", new { });
    private static async Task<SelectionDetails> Selection(Task<HttpResponseMessage> task) { using var response = await task; Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<SelectionDetails>(Json))!; }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task ReadyRandomSelectionPersistsProofRightAndCycleState(bool organizer)
    {
        var (s, cycle) = await SelectionReady(organizer); using var owner = Owner(s); var result = await Selection(Select(owner, s, cycle.Id));
        Assert.Equal(SelectionMethod.Random, result.SelectionMethod); Assert.Equal(20, result.EligibleMemberCount); Assert.Equal("DHANVI_RANDOM_V1", result.AlgorithmVersion);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var stored = await db.SelectionResults.Include(r => r.EligibleMembers).SingleAsync(r => r.Id == result.Id); Assert.Equal(20, stored.EligibleMembers.Count); Assert.True(RandomDrawVerifier.Verify(stored.Proof()).Valid);
        var winner = await db.Memberships.SingleAsync(m => m.Id == result.Winner.MembershipId); Assert.True(winner.HasBeenSelectedForPayout); Assert.Equal(1, winner.PayoutCycleNumber);
        Assert.Equal(1, await db.Memberships.CountAsync(m => m.GroupId == s.GroupId && m.HasBeenSelectedForPayout)); var completed = await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id); Assert.Equal(CycleStatus.SelectionCompleted, completed.Status); Assert.NotNull(completed.SelectionCompletedAt); Assert.Equal(result.Id, completed.SelectionResultId);
        Assert.All(await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId && c.CycleNumber > 1).ToListAsync(), c => Assert.Equal(CycleStatus.Upcoming, c.Status));
        Assert.True(await db.AuditEvents.AnyAsync(a => a.GroupId == s.GroupId && a.Action == "RANDOM_DRAW_EXECUTED" && a.SelectionResultId == result.Id && a.AlgorithmVersion == "DHANVI_RANDOM_V1"));
    }
    [Theory] [InlineData(GroupType.Random)] [InlineData(GroupType.Auction)]
    public async Task ReservedCycleSelectsOnlyOrganizerWithoutEntropy(GroupType type)
    {
        var (s, cycle) = await SelectionReady(true, true, type); using var owner = Owner(s); var before = fixture.RandomSource.Calls; var result = await Selection(Select(owner, s, cycle.Id)); Assert.Equal(before, fixture.RandomSource.Calls); Assert.Equal("ORGANIZER_RESERVED_V1", result.AlgorithmVersion); Assert.False(result.VerificationAvailable);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var winner = await db.Memberships.SingleAsync(m => m.Id == result.Winner.MembershipId); Assert.Equal(s.OwnerId, winner.UserId);
        var stored = await db.SelectionResults.SingleAsync(r => r.Id == result.Id); Assert.Null(stored.SeedReveal); Assert.True(await db.AuditEvents.AnyAsync(a => a.GroupId == s.GroupId && a.Action == "ORGANIZER_RESERVED_SELECTION_EXECUTED"));
        using var verify = await owner.GetAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/selection/verify"); Assert.Equal(HttpStatusCode.Conflict, verify.StatusCode); Assert.Contains("RANDOM_VERIFICATION_NOT_APPLICABLE", await verify.Content.ReadAsStringAsync());
    }
    [Fact] public async Task AuctionSelectionIsExplicitlyRejected()
    {
        var (s, cycle) = await SelectionReady(type: GroupType.Auction); using var owner = Owner(s); var before = fixture.RandomSource.Calls; using var response = await Select(owner, s, cycle.Id); Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("AUCTION_SELECTION_NOT_SUPPORTED_HERE", await response.Content.ReadAsStringAsync()); Assert.Equal(before, fixture.RandomSource.Calls);
    }
    [Fact] public async Task NonReadyAndSuspendedCyclesCannotSelect()
    {
        var s = await Seed(); using var owner = Owner(s); var cycles = await Activate(owner, s); using var early = await Select(owner, s, cycles[0].Id); Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        var (ready, cycle) = await SelectionReady(); using var readyOwner = Owner(ready); using var suspend = await readyOwner.PostAsJsonAsync($"/api/v1/admin/groups/{ready.GroupId}/suspend", new { reason = "Pause before draw" }); suspend.EnsureSuccessStatusCode();
        using var blocked = await Select(readyOwner, ready, cycle.Id); Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode); Assert.Contains("GROUP_SUSPENDED", await blocked.Content.ReadAsStringAsync());
    }
    [Fact] public async Task OrdinaryMemberAndUnrelatedOrganizerCannotExecute()
    {
        var (s, cycle) = await SelectionReady(true); using var member = Client(s.MemberIds[0]); using var response = await Select(member, s, cycle.Id); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var other = await Seed(organizer: true); using var unrelated = Owner(other); using var denied = await Select(unrelated, s, cycle.Id); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }
    [Fact] public async Task PreviewDoesNotGenerateOrExposeSeed()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var before = fixture.RandomSource.Calls; var preview = await owner.GetStringAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/selection/preview"); Assert.Contains("eligibleMemberCount", preview); Assert.DoesNotContain("seed", preview, StringComparison.OrdinalIgnoreCase); Assert.Equal(before, fixture.RandomSource.Calls);
    }
    [Fact] public async Task ConcurrentAndRepeatedSelectionsReturnOneResultAndUseEntropyOnce()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var before = fixture.RandomSource.Calls;
        var results = await Task.WhenAll(Selection(Select(owner, s, cycle.Id)), Selection(Select(owner, s, cycle.Id))); Assert.Equal(results[0].Id, results[1].Id); Assert.Equal(results[0].Winner.MembershipId, results[1].Winner.MembershipId); Assert.Equal(before + 1, fixture.RandomSource.Calls);
        var repeated = await Selection(Select(owner, s, cycle.Id)); Assert.Equal(results[0].Id, repeated.Id); Assert.Equal(before + 1, fixture.RandomSource.Calls);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); Assert.Equal(1, await db.SelectionResults.CountAsync(r => r.CycleId == cycle.Id)); Assert.Equal(1, await db.Memberships.CountAsync(m => m.GroupId == s.GroupId && m.HasBeenSelectedForPayout));
    }
    [Theory] [InlineData(1)] [InlineData(0)] public async Task LastAndZeroEligibleMembersAreHandled(int remaining)
    {
        var (s, cycle) = await SelectionReady(); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var members = await db.Memberships.Where(m => m.GroupId == s.GroupId).OrderBy(m => m.SlotNumber).ToListAsync();
        foreach (var member in members.Take(20 - remaining)) member.SelectForPayout(1, fixture.Clock.UtcNow); await db.SaveChangesAsync(); using var owner = Owner(s);
        if (remaining == 1) { var result = await Selection(Select(owner, s, cycle.Id)); Assert.Equal(1, result.EligibleMemberCount); Assert.Equal(members[^1].Id, result.Winner.MembershipId); }
        else { var before = fixture.RandomSource.Calls; using var response = await Select(owner, s, cycle.Id); Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("NO_ELIGIBLE_MEMBERS", await response.Content.ReadAsStringAsync()); Assert.Equal(before, fixture.RandomSource.Calls); Assert.False(await db.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id)); Assert.Equal(CycleStatus.ReadyForSelection, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status); }
    }
    [Fact] public async Task MemberResultAndVerificationAreSafeAndNonMembersAreDenied()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var selected = await Selection(Select(owner, s, cycle.Id)); using var member = Client(s.MemberIds[0]);
        var body = await member.GetStringAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/selection"); Assert.Contains(selected.Winner.MembershipId.ToString(), body); Assert.DoesNotContain("@", body); Assert.DoesNotContain("phone", body, StringComparison.OrdinalIgnoreCase);
        var verification = await member.GetFromJsonAsync<SelectionVerification>($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/selection/verify", Json); Assert.True(verification!.Valid); Assert.True(RandomDrawVerifier.Verify(verification.Proof).Valid);
        var proofJson = System.Text.Json.JsonSerializer.Serialize(verification); Assert.DoesNotContain("email", proofJson, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("address", proofJson, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("phone", proofJson, StringComparison.OrdinalIgnoreCase);
        var other = await Seed(); using var stranger = Client(other.MemberIds[0]); using var denied = await stranger.GetAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/selection/verify"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.True(await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().AuditEvents.AnyAsync(a => a.SelectionResultId == selected.Id && a.Action == "RANDOM_DRAW_VERIFIED"));
    }
    [Fact] public async Task CompletedResultAndSnapshotCannotBeMutatedAndCycleIsUnique()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var result = await Selection(Select(owner, s, cycle.Id)); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.SelectionResults.Where(r => r.Id == result.Id).ExecuteUpdateAsync(setters => setters.SetProperty(r => r.ResultHash, "tampered")));
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.SelectionEligibleMembers.Where(e => e.SelectionResultId == result.Id).ExecuteDeleteAsync());
        var stored = await db.SelectionResults.Include(r => r.EligibleMembers).SingleAsync(r => r.Id == result.Id); db.SelectionResults.Add(SelectionResult.Random(stored.Proof(), stored.WinnerUserId, s.OwnerId, fixture.Clock.UtcNow, "DETERMINISTIC_TEST")); var exception = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync()); Assert.Equal("23505", Assert.IsType<Npgsql.PostgresException>(exception.InnerException).SqlState);
    }
    [Fact] public async Task FailedSelectionRollsBackWinnerCycleResultAndAudit()
    {
        var (s, cycle) = await SelectionReady(); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var name = $"fail_selection_{s.GroupId:N}";
        var sql = $$"""
            CREATE FUNCTION groups.{{name}}() RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN IF NEW."GroupId" = '{{s.GroupId}}'::uuid THEN RAISE EXCEPTION 'Injected snapshot failure'; END IF; RETURN NEW; END; $body$;
            CREATE TRIGGER {{name}} BEFORE INSERT ON groups."SelectionEligibleMembers" FOR EACH ROW EXECUTE FUNCTION groups.{{name}}();
            """;
        await db.Database.ExecuteSqlRawAsync(sql);
        try
        {
            using var owner = Owner(s); using var response = await Select(owner, s, cycle.Id); Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.False(await db.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id)); Assert.False(await db.Memberships.AnyAsync(m => m.GroupId == s.GroupId && m.HasBeenSelectedForPayout)); Assert.Equal(CycleStatus.ReadyForSelection, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status); Assert.False(await db.AuditEvents.AnyAsync(a => a.GroupId == s.GroupId && a.Action == "RANDOM_DRAW_EXECUTED"));
        }
        finally { var cleanup = $"DROP TRIGGER {name} ON groups.\"SelectionEligibleMembers\"; DROP FUNCTION groups.{name}();"; await db.Database.ExecuteSqlRawAsync(cleanup); }
    }
    [Fact] public async Task ContributionReversalIsBlockedAfterSelection()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var row = (await Rows(owner, s, cycle.Id))[0]; await Selection(Select(owner, s, cycle.Id)); using var reverse = await Operation(owner, s, row, new ReverseContributionRequest(row.Entries[0].Id, "Too late"), "late-reverse", true); Assert.Equal(HttpStatusCode.Conflict, reverse.StatusCode);
    }
}
