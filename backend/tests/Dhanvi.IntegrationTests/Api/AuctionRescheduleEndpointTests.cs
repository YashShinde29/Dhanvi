using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dhanvi.IntegrationTests.Api;

// Auction rescheduling through the real API and PostgreSQL: authority per namespace, persisted history, replay and races.
public sealed partial class CycleEndpointTests
{
    private static Task<HttpResponseMessage> Reschedule(HttpClient client, string scope, Scenario s, Guid cycleId, DateTimeOffset start, DateTimeOffset? end = null, AuctionScheduleReason reason = AuctionScheduleReason.PublicHoliday, string key = "resched-1", int? expected = null, string? text = null, string? message = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{scope}/groups/{s.GroupId}/cycles/{cycleId}/auction/reschedule") { Content = JsonContent.Create(new RescheduleAuctionRequest(start, end ?? start.AddHours(1), reason, text, message, expected), options: Json) };
        request.Headers.Add("Idempotency-Key", key); return Send(client, request);
    }
    private static Task<AuctionScheduleHistoryPage?> History(HttpClient client, Scenario s, Guid cycleId, int page = 1, int pageSize = 5) => client.GetFromJsonAsync<AuctionScheduleHistoryPage>(AuctionPath(s, cycleId) + $"/schedule-history?page={page}&pageSize={pageSize}", Json);
    private static Task<AuctionScheduleHistoryPage?> GroupHistory(HttpClient client, string scope, Scenario s, Guid? cycleId = null, int page = 1, int pageSize = 20) => client.GetFromJsonAsync<AuctionScheduleHistoryPage>($"/api/v1/{scope}/groups/{s.GroupId}/auction-schedule-history?page={page}&pageSize={pageSize}{(cycleId.HasValue ? $"&cycleId={cycleId}" : "")}", Json);
    private static async Task<string> Code(HttpResponseMessage response, HttpStatusCode status) { Assert.Equal(status, response.StatusCode); return await response.Content.ReadAsStringAsync(); }
    private static DateTimeOffset RuleStart(CycleDetails cycle) => new(cycle.SelectionDate.ToDateTime(new(10, 0)), TimeSpan.Zero);
    /// <summary>A real, active identity with the given role (the authorization check requires an active user, not just a claim).</summary>
    private async Task<HttpClient> UserClient(string role)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var identities = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = NewUser(fixture.Clock.UtcNow); identities.Users.Add(user); await identities.SaveChangesAsync(); return Client(user.Id, role);
    }

    [Theory]
    [InlineData(true)]   // organizer-created group: owning organizer through /organizer
    [InlineData(false)]  // platform group: admin through /admin
    public async Task OwnerReschedulesScheduledAuctionAndEveryViewerSeesTheNewWindow(bool organizer)
    {
        var (s, cycle) = await AuctionReady(organizer, open: false); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        fixture.Clock.UtcNow = RuleStart(cycle).AddDays(-1);
        var before = (await member.GetFromJsonAsync<AuctionDetails>(AuctionPath(s, cycle.Id), Json))!;
        Assert.Equal("SCHEDULED", before.Status); Assert.Null(before.Id); Assert.False(before.WasRescheduled);
        var target = new DateTimeOffset(RuleStart(cycle).AddDays(1).UtcDateTime.Date.AddHours(13).AddMinutes(30), TimeSpan.Zero); // 7:00 PM IST next day
        var updated = await AuctionResponse(Reschedule(owner, s.Scope, s, cycle.Id, target, target.AddHours(1), AuctionScheduleReason.OrganizerRequest, expected: before.ScheduleVersion, text: "Requested on the members' WhatsApp group", message: "Moved by a day at members' request."));
        Assert.Equal((target, target.AddHours(1), true, 1, "SCHEDULED"), (updated.StartsAt, updated.EndsAt, updated.WasRescheduled, updated.RescheduleCount, updated.Status));
        Assert.Equal(RuleStart(cycle), updated.OriginalStartsAt); Assert.NotNull(updated.Id); Assert.True(updated.ScheduleVersion > 0);
        Assert.Equal((RuleStart(cycle), AuctionScheduleReason.OrganizerRequest, "Moved by a day at members' request."), (updated.PreviousStartsAt, updated.LatestReasonCode, updated.LatestMemberMessage));
        var history = Assert.Single((await History(owner, s, cycle.Id))!.Items); Assert.Equal((RuleStart(cycle), target, organizer ? "ORGANIZER" : "ADMIN", "Requested on the members' WhatsApp group"), (history.PreviousStartsAt, history.NewStartsAt, history.ChangedByRole, history.ReasonText));
        // Member read model: latest schedule, reason code and member message; history sanitized (no internal text, no actor).
        var seen = (await member.GetFromJsonAsync<AuctionDetails>(AuctionPath(s, cycle.Id), Json))!;
        Assert.Equal(target, seen.StartsAt); Assert.True(seen.WasRescheduled); Assert.Equal(RuleStart(cycle), seen.OriginalStartsAt); Assert.False(seen.CanReschedule);
        Assert.Equal((AuctionScheduleReason.OrganizerRequest, "Moved by a day at members' request."), (seen.LatestReasonCode, seen.LatestMemberMessage));
        var memberRow = Assert.Single((await History(member, s, cycle.Id))!.Items); Assert.Null(memberRow.ReasonText); Assert.Null(memberRow.ChangedByRole); Assert.Null(memberRow.ChangedByName); Assert.Equal("Moved by a day at members' request.", memberRow.MemberMessage);
        using var memberGroupHistory = await member.GetAsync($"/api/v1/organizer/groups/{s.GroupId}/auction-schedule-history"); Assert.Equal(HttpStatusCode.Forbidden, memberGroupHistory.StatusCode);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var auction = await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id);
        Assert.Equal((AuctionStatus.Scheduled, target, 1), (auction.Status, auction.StartsAt, auction.RescheduleCount)); Assert.Equal(TimeSpan.Zero, auction.StartsAt.Offset);
        var change = await db.AuctionScheduleChanges.SingleAsync(c => c.AuctionId == auction.Id);
        Assert.Equal((1, RuleStart(cycle), RuleStart(cycle).AddHours(1), target, AuctionScheduleReason.OrganizerRequest, s.OwnerId), (change.ChangeSequence, change.PreviousStartsAt, change.PreviousEndsAt, change.NewStartsAt, change.ReasonCode, change.ChangedByUserId));
        Assert.Equal((RuleStart(cycle), target, 1), (auction.OriginalStartsAt, auction.StartsAt, auction.RescheduleCount));
        Assert.Equal(1, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "AUCTION_RESCHEDULED" && e.SubjectId == change.Id));
        Assert.Equal(1, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "AUCTION_CREATED"));
        // The old trigger time no longer opens the auction; the new one does, and bidding/closing are unchanged.
        fixture.Clock.UtcNow = RuleStart(cycle).AddTicks(17);
        using var early = await ManageAuction(owner, s, cycle.Id, "open"); Assert.Contains("AUCTION_OUTSIDE_WINDOW", await Code(early, HttpStatusCode.Conflict));
        fixture.Clock.UtcNow = target.AddTicks(17);
        var opened = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "open")); Assert.Equal("OPEN", opened.Status); Assert.True(opened.WasRescheduled);
        await BidResponse(PlaceBid(member, s, cycle.Id));
        using var live = await Reschedule(owner, s.Scope, s, cycle.Id, target.AddDays(1), key: "resched-2"); Assert.Contains("AUCTION_ALREADY_OPEN", await Code(live, HttpStatusCode.Conflict));
        var closed = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")); Assert.Equal("WINNER_SELECTED", closed.Status); Assert.Equal(35000, closed.Result!.WinnerPayout);
        using var done = await Reschedule(owner, s.Scope, s, cycle.Id, target.AddDays(2), key: "resched-3"); Assert.Contains("AUCTION_ALREADY_COMPLETED", await Code(done, HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task AuthorityIsEnforcedByTheBackendNotTheNamespace()
    {
        var (s, cycle) = await AuctionReady(organizer: true, open: false); fixture.Clock.UtcNow = RuleStart(cycle).AddDays(-1); var target = RuleStart(cycle).AddDays(1);
        // Another organizer, even through the organizer namespace, is refused; a member is refused by the route policy.
        using var stranger = await UserClient("ORGANIZER");
        using var refused = await Reschedule(stranger, "organizer", s, cycle.Id, target); Assert.Contains("AUCTION_PERMISSION_DENIED", await Code(refused, HttpStatusCode.Forbidden));
        using var member = Client(s.MemberIds[0]);
        using var memberRefused = await Reschedule(member, "organizer", s, cycle.Id, target); Assert.Equal(HttpStatusCode.Forbidden, memberRefused.StatusCode);
        using var memberAdmin = await Reschedule(member, "admin", s, cycle.Id, target); Assert.Equal(HttpStatusCode.Forbidden, memberAdmin.StatusCode);
        // An admin may reschedule an organizer-created group's auction.
        using var admin = await UserClient("ADMIN");
        var byAdmin = await AuctionResponse(Reschedule(admin, "admin", s, cycle.Id, target, reason: AuctionScheduleReason.OperationalIssue));
        Assert.Equal(AuctionScheduleReason.OperationalIssue, byAdmin.LatestReasonCode); Assert.Equal("ADMIN", Assert.Single((await History(admin, s, cycle.Id))!.Items).ChangedByRole);
        // Group-wide history: admin any group, owning organizer own group, another organizer refused.
        Assert.Single((await GroupHistory(admin, "admin", s))!.Items); using var owner = Owner(s); Assert.Single((await GroupHistory(owner, "organizer", s))!.Items);
        using var strangerHistory = await stranger.GetAsync($"/api/v1/organizer/groups/{s.GroupId}/auction-schedule-history"); Assert.Equal(HttpStatusCode.Forbidden, strangerHistory.StatusCode);
        using var db = fixture.Factory.Services.CreateScope(); Assert.Equal(1, await db.ServiceProvider.GetRequiredService<GroupsDbContext>().AuctionScheduleChanges.CountAsync(c => c.CycleId == cycle.Id));
        // A platform group's organizer-namespace call is refused for a non-owner organizer.
        var (platform, platformCycle) = await AuctionReady(organizer: false, open: false);
        using var orgOnPlatform = await Reschedule(stranger, "organizer", platform, platformCycle.Id, RuleStart(platformCycle).AddDays(1)); Assert.Equal(HttpStatusCode.Forbidden, orgOnPlatform.StatusCode);
    }

    [Fact]
    public async Task ValidationErrorsAreStableCodes()
    {
        var (s, cycle) = await AuctionReady(organizer: true, open: false); using var owner = Owner(s); fixture.Clock.UtcNow = RuleStart(cycle).AddDays(-1); var target = RuleStart(cycle).AddDays(1);
        using var other = await Reschedule(owner, s.Scope, s, cycle.Id, target, reason: AuctionScheduleReason.Other, text: "  "); Assert.Contains("AUCTION_RESCHEDULE_REASON_REQUIRED", await Code(other, HttpStatusCode.Conflict));
        using var invalid = await Send(owner, new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{cycle.Id}/auction/reschedule") { Content = new StringContent($$"""{"newStartsAt":"{{target:O}}","newEndsAt":"{{target.AddHours(1):O}}","reasonCode":"NOT_A_REASON"}""", System.Text.Encoding.UTF8, "application/json"), Headers = { { "Idempotency-Key", "bad-code" } } });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var missing = await Send(owner, new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{cycle.Id}/auction/reschedule") { Content = new StringContent($$"""{"newStartsAt":"{{target:O}}","newEndsAt":"{{target.AddHours(1):O}}"}""", System.Text.Encoding.UTF8, "application/json"), Headers = { { "Idempotency-Key", "no-code" } } });
        Assert.Contains("AUCTION_RESCHEDULE_REASON_REQUIRED", await Code(missing, HttpStatusCode.Conflict));
        using var range = await Reschedule(owner, s.Scope, s, cycle.Id, target, target); Assert.Contains("AUCTION_INVALID_TIME_RANGE", await Code(range, HttpStatusCode.Conflict));
        using var past = await Reschedule(owner, s.Scope, s, cycle.Id, fixture.Clock.UtcNow.AddMinutes(-1)); Assert.Contains("AUCTION_NEW_START_IN_PAST", await Code(past, HttpStatusCode.Conflict));
        using var noKey = await Send(owner, new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{cycle.Id}/auction/reschedule") { Content = JsonContent.Create(new RescheduleAuctionRequest(target, target.AddHours(1), AuctionScheduleReason.PublicHoliday), options: Json) });
        Assert.Contains("IDEMPOTENCY_KEY_REQUIRED", await Code(noKey, HttpStatusCode.Conflict));
        using var db = fixture.Factory.Services.CreateScope(); Assert.Equal(0, await db.ServiceProvider.GetRequiredService<GroupsDbContext>().Auctions.CountAsync(a => a.CycleId == cycle.Id));
    }

    [Fact]
    public async Task ReplayReturnsTheSameOutcomeAndStaleVersionsConflict()
    {
        var (s, cycle) = await AuctionReady(organizer: true, open: false); using var owner = Owner(s); using var admin = await UserClient("ADMIN");
        fixture.Clock.UtcNow = RuleStart(cycle).AddDays(-1); var target = RuleStart(cycle).AddDays(1);
        var first = await AuctionResponse(Reschedule(owner, s.Scope, s, cycle.Id, target, key: "same"));
        var replay = await AuctionResponse(Reschedule(owner, s.Scope, s, cycle.Id, target, key: "same"));
        Assert.Equal((first.StartsAt, first.RescheduleCount, first.ScheduleVersion), (replay.StartsAt, replay.RescheduleCount, replay.ScheduleVersion));
        using var reused = await Reschedule(owner, s.Scope, s, cycle.Id, target.AddHours(2), key: "same"); Assert.Contains("IDEMPOTENCY_KEY_REUSED", await Code(reused, HttpStatusCode.Conflict));
        // Organizer's screen still shows version `first`; the admin moves it again first.
        await AuctionResponse(Reschedule(admin, "admin", s, cycle.Id, target.AddDays(1), key: "admin-1", expected: first.ScheduleVersion));
        using var stale = await Reschedule(owner, s.Scope, s, cycle.Id, target.AddDays(2), key: "org-stale", expected: first.ScheduleVersion);
        Assert.Contains("AUCTION_SCHEDULE_CONFLICT", await Code(stale, HttpStatusCode.Conflict));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.Equal([1, 2], await db.AuctionScheduleChanges.Where(c => c.CycleId == cycle.Id).OrderBy(c => c.ChangeSequence).Select(c => c.ChangeSequence).ToListAsync());
        Assert.Equal(target.AddDays(1), (await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id)).StartsAt);
        Assert.Equal(2, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "AUCTION_RESCHEDULED"));
    }

    [Fact]
    public async Task ConcurrentReschedulesSerializeAndOnlyOneWinsPerVersion()
    {
        var (s, cycle) = await AuctionReady(organizer: true, open: false); using var owner = Owner(s); using var admin = await UserClient("ADMIN");
        fixture.Clock.UtcNow = RuleStart(cycle).AddDays(-1); var target = RuleStart(cycle).AddDays(1);
        // Both act on version 0 at the same moment: the row lock serializes them, the version check rejects the loser.
        var responses = await Task.WhenAll(Reschedule(owner, s.Scope, s, cycle.Id, target, key: "org", expected: 0), Reschedule(admin, "admin", s, cycle.Id, target.AddHours(3), key: "adm", expected: 0));
        try
        {
            Assert.Single(responses, r => r.IsSuccessStatusCode);
            var loser = Assert.Single(responses, r => !r.IsSuccessStatusCode); var body = await loser.Content.ReadAsStringAsync();
            Assert.True(loser.StatusCode == HttpStatusCode.Conflict && body.Contains("AUCTION_SCHEDULE_CONFLICT"), $"{loser.StatusCode}: {body}");
            using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            var changes = await db.AuctionScheduleChanges.Where(c => c.CycleId == cycle.Id).ToListAsync(); var change = Assert.Single(changes);
            var auction = await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id); Assert.Equal(change.NewStartsAt, auction.StartsAt); Assert.Equal(1, auction.RescheduleCount);
        }
        finally { foreach (var r in responses) r.Dispose(); }
    }

    [Fact]
    public async Task HistoryIsScopedPerCyclePagedAndImmutable()
    {
        var (s, cycle1) = await AuctionReady(organizer: true, open: false); using var owner = Owner(s); fixture.Clock.UtcNow = RuleStart(cycle1).AddDays(-1);
        // Cycle 1: three reschedules through the API.
        for (var i = 1; i <= 3; i++) { fixture.Clock.UtcNow = fixture.Clock.UtcNow.AddMinutes(1); await AuctionResponse(Reschedule(owner, s.Scope, s, cycle1.Id, RuleStart(cycle1).AddDays(i), key: $"c1-{i}", reason: AuctionScheduleReason.MemberAvailability)); }
        // Cycle 2: a scheduled auction with two reschedules written through the domain (the cycle is still upcoming).
        Guid cycle2Id; using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var group = await db.Groups.SingleAsync(g => g.Id == s.GroupId);
            var cycle2 = await db.MonthlyCycles.SingleAsync(c => c.GroupId == s.GroupId && c.CycleNumber == 2); cycle2Id = cycle2.Id;
            var start = new DateTimeOffset(cycle2.SelectionDate.ToDateTime(new(10, 0)), TimeSpan.Zero); var now = fixture.Clock.UtcNow;
            var auction = Auction.Schedule(group.Id, cycle2.Id, 2, group.GroupValue, group.MemberLimit, group.Rules.AuctionRules!, start, start.AddHours(1), now);
            for (var i = 1; i <= 2; i++) { var (ps, pe) = auction.Reschedule(start.AddDays(i), start.AddDays(i).AddHours(1), AuctionScheduleReason.Emergency, "Power outage", now.AddMinutes(i)); db.AuctionScheduleChanges.Add(new(auction.Id, group.Id, cycle2.Id, auction.RescheduleCount, ps, pe, auction.StartsAt, auction.EndsAt, AuctionScheduleReason.Emergency, "Grid failure ticket 77", "Power outage", s.OwnerId, "ORGANIZER", now.AddMinutes(i))); }
            db.Auctions.Add(auction); await db.SaveChangesAsync();
        }
        // Each cycle's history is scoped to its own auction.
        var h1 = (await History(owner, s, cycle1.Id))!; var h2 = (await History(owner, s, cycle2Id))!;
        Assert.Equal(3, h1.TotalCount); Assert.All(h1.Items, i => Assert.Equal(cycle1.Id, i.CycleId)); Assert.Equal([3, 2, 1], h1.Items.Select(i => i.ChangeSequence));
        Assert.Equal(2, h2.TotalCount); Assert.All(h2.Items, i => { Assert.Equal(cycle2Id, i.CycleId); Assert.Equal(2, i.CycleNumber); Assert.Equal(AuctionScheduleReason.Emergency, i.ReasonCode); });
        // The auction read never carries history — only the latest summary.
        var view = (await owner.GetFromJsonAsync<AuctionDetails>(AuctionPath(s, cycle1.Id), Json))!; Assert.Equal(3, view.RescheduleCount); Assert.Equal(RuleStart(cycle1).AddDays(2), view.PreviousStartsAt);
        Assert.DoesNotContain("scheduleHistory", await owner.GetStringAsync(AuctionPath(s, cycle1.Id)));
        // Group-wide history: all five, newest first; cycle filter; server-side pages.
        var all = (await GroupHistory(owner, "organizer", s))!; Assert.Equal(5, all.TotalCount); Assert.Equal(5, all.Items.Count); Assert.True(all.Items[0].ChangedAt >= all.Items[^1].ChangedAt);
        var onlyCycle1 = (await GroupHistory(owner, "organizer", s, cycle1.Id))!; Assert.Equal(3, onlyCycle1.TotalCount); Assert.All(onlyCycle1.Items, i => Assert.Equal(1, i.CycleNumber));
        var page2 = (await GroupHistory(owner, "organizer", s, null, 2, 2))!; Assert.Equal((5, 2, 2, 2), (page2.TotalCount, page2.Page, page2.PageSize, page2.Items.Count));
        var page3 = (await GroupHistory(owner, "organizer", s, null, 3, 2))!; Assert.Single(page3.Items);
        Assert.Equal(5, new[] { (await GroupHistory(owner, "organizer", s, null, 1, 2))!, page2, page3 }.SelectMany(p => p.Items).Select(i => i.Id).Distinct().Count());
        // Immutable: UPDATE and DELETE are refused by the database itself.
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            var update = await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE groups.\"AuctionScheduleChanges\" SET \"ReasonText\" = 'edited' WHERE \"CycleId\" = {cycle1.Id}"));
            Assert.Contains("immutable", update.Message);
            var delete = await Assert.ThrowsAnyAsync<Exception>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM groups.\"AuctionScheduleChanges\" WHERE \"CycleId\" = {cycle1.Id}"));
            Assert.Contains("immutable", delete.Message);
            Assert.Equal(5, await db.AuctionScheduleChanges.CountAsync(c => c.GroupId == s.GroupId));
        }
    }
}
