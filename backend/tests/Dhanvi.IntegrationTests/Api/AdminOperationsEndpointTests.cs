using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Admin.Application;
using Dhanvi.Modules.Groups.Application;
namespace Dhanvi.IntegrationTests.Api;

// Admin Control Center read models: authorization boundary, aggregated group operations, and the per-group summary.
public sealed partial class CycleEndpointTests
{
    [Fact] public async Task AdminOperationsViewsRequireAdminRole()
    {
        var s = await Seed(count: 2); using var member = Client(s.MemberIds[0]); using var organizer = Client(s.OwnerId, "ORGANIZER");
        foreach (var client in new[] { member, organizer })
            foreach (var path in new[] { "/api/v1/admin/operations/overview", "/api/v1/admin/groups/operations", $"/api/v1/admin/groups/{s.GroupId}/operations-summary" })
            { using var response = await client.GetAsync(path); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode); }
        using var anonymous = fixture.Factory.CreateClient(); using var unauthenticated = await anonymous.GetAsync("/api/v1/admin/operations/overview");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthenticated.StatusCode);
    }

    [Fact] public async Task GroupOperationsListAggregatesCurrentCycleAndFiltersByCycleState()
    {
        var s = await Seed(count: 2); using var admin = Owner(s); var cycles = await Activate(admin, s);
        var page = (await admin.GetFromJsonAsync<AdminGroupOperationsPage>("/api/v1/admin/groups/operations?status=ACTIVE&creatorType=PLATFORM&pageSize=100", Json))!;
        var row = Assert.Single(page.Items, r => r.Id == s.GroupId);
        Assert.Equal("PLATFORM", row.CreatorType); Assert.Equal("ACTIVE", row.Status); Assert.Equal(2, row.ActiveMemberCount); Assert.Equal(0, row.TermsPendingCount);
        Assert.NotNull(row.CurrentCycle); Assert.Equal("COLLECTING_CONTRIBUTIONS", row.CurrentCycle!.Status); Assert.Equal(2, row.CurrentCycle.OutstandingMemberCount); Assert.Equal(0, row.CurrentCycle.SettledMemberCount);
        Assert.Equal(AdminPayoutCounts.Empty, row.Payouts); Assert.Equal(AdminPaymentCounts.Empty, row.Payments); Assert.NotNull(row.LastActivityAt);
        var collecting = (await admin.GetFromJsonAsync<AdminGroupOperationsPage>("/api/v1/admin/groups/operations?cycleStatus=COLLECTING_CONTRIBUTIONS&pageSize=100", Json))!;
        Assert.Contains(collecting.Items, r => r.Id == s.GroupId);
        var ready = (await admin.GetFromJsonAsync<AdminGroupOperationsPage>("/api/v1/admin/groups/operations?cycleStatus=READY_FOR_SELECTION&pageSize=100", Json))!;
        Assert.DoesNotContain(ready.Items, r => r.Id == s.GroupId);
        foreach (var contribution in await Rows(admin, s, cycles[0].Id)) await Result(Operation(admin, s, contribution, new RecordContributionRequest(contribution.ExpectedAmount, "ops-ready", null), contribution.Id.ToString()));
        ready = (await admin.GetFromJsonAsync<AdminGroupOperationsPage>("/api/v1/admin/groups/operations?cycleStatus=READY_FOR_SELECTION&pageSize=100", Json))!;
        var readyRow = Assert.Single(ready.Items, r => r.Id == s.GroupId); Assert.Equal("READY_FOR_SELECTION", readyRow.CurrentCycle!.Status); Assert.Equal(0, readyRow.CurrentCycle.OutstandingMemberCount);
        using var invalid = await admin.GetAsync("/api/v1/admin/groups/operations?cycleStatus=NOT_A_STATE"); Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact] public async Task GroupOperationsSummaryListsOutstandingContributionsIssuesAndActivity()
    {
        var s = await Seed(count: 2); using var admin = Owner(s); var cycles = await Activate(admin, s);
        var summary = (await admin.GetFromJsonAsync<AdminGroupOperationsSummary>($"/api/v1/admin/groups/{s.GroupId}/operations-summary", Json))!;
        Assert.Equal(s.GroupId, summary.Group.Id); Assert.Equal(2, summary.Cycles.Count); Assert.Equal(2, summary.OutstandingContributions.Count);
        Assert.All(summary.OutstandingContributions, o => { Assert.Equal(25000m, o.ExpectedAmount); Assert.Equal("PENDING", o.Status); Assert.NotNull(o.SlotNumber); });
        Assert.Empty(summary.Issues); // outstanding contributions before the due date are progress, not an issue
        Assert.Contains(summary.Activity, a => a.Source == "GROUP" && a.Action == "GROUP_ACTIVATED");
        Assert.Empty(summary.Payouts); Assert.Empty(summary.PaymentIssues);
        var first = await Rows(admin, s, cycles[0].Id);
        await Result(Operation(admin, s, first[0], new RecordContributionRequest(first[0].ExpectedAmount, "ops-summary", null), first[0].Id.ToString()));
        summary = (await admin.GetFromJsonAsync<AdminGroupOperationsSummary>($"/api/v1/admin/groups/{s.GroupId}/operations-summary", Json))!;
        var remaining = Assert.Single(summary.OutstandingContributions); Assert.Equal(first[1].Id, remaining.ContributionId); Assert.Equal(1, summary.Group.CurrentCycle!.SettledMemberCount);
        using var missing = await admin.GetAsync($"/api/v1/admin/groups/{Guid.NewGuid()}/operations-summary"); Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact] public async Task OperationsOverviewCountsActiveGroupsCollectingCyclesAndMembers()
    {
        var s = await Seed(count: 2); using var admin = Owner(s); await Activate(admin, s);
        var overview = (await admin.GetFromJsonAsync<AdminOperationsOverview>("/api/v1/admin/operations/overview", Json))!;
        Assert.True(overview.Groups.Active >= 1); Assert.True(overview.Groups.CyclesCollecting >= 1); Assert.True(overview.Groups.ActiveMembers >= 2); Assert.True(overview.Groups.Total >= overview.Groups.Active);
        Assert.NotNull(overview.Payments.Counts); Assert.NotNull(overview.Payouts.Counts); Assert.NotNull(overview.Organizers.ApplicationsPending);
        Assert.True(overview.GeneratedAt <= fixture.Clock.UtcNow.AddMinutes(1));
    }
}
