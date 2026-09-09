using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dhanvi.IntegrationTests.Api;

public sealed partial class CycleEndpointTests
{
    private async Task<(Scenario Scenario, CycleDetails Cycle)> AuctionReady(bool organizer = false, bool reserved = false, bool open = true)
    {
        var s = await Seed(type: GroupType.Auction, organizer: organizer, reserved: reserved,
            auctionRules: new(5000, 20000, 500, new(10, 0), new(11, 0)));
        using var owner = Owner(s); var cycle = (await Activate(owner, s))[0];
        foreach (var row in await Rows(owner, s, cycle.Id))
            await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "auction-ready", null), row.Id.ToString()));
        fixture.Clock.UtcNow = new DateTimeOffset(cycle.SelectionDate.ToDateTime(new(10, 0)), TimeSpan.Zero).AddTicks(17);
        if (open) await AuctionResponse(ManageAuction(owner, s, cycle.Id, "open"));
        return (s, cycle);
    }
    private static string AuctionPath(Scenario s, Guid cycleId) => $"/api/v1/groups/{s.GroupId}/cycles/{cycleId}/auction";
    private static Task<HttpResponseMessage> ManageAuction(HttpClient client, Scenario s, Guid cycleId, string action) =>
        client.PostAsJsonAsync($"/api/v1/{s.Scope}/groups/{s.GroupId}/cycles/{cycleId}/auction/{action}", new { });
    private static Task<HttpResponseMessage> PlaceBid(HttpClient client, Scenario s, Guid cycleId, decimal amount = 15000, string key = "bid")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, AuctionPath(s, cycleId) + "/bids") { Content = JsonContent.Create(new PlaceAuctionBidRequest(amount)) };
        request.Headers.Add("Idempotency-Key", key); return Send(client, request);
    }
    private static async Task<AuctionDetails> AuctionResponse(Task<HttpResponseMessage> task)
    {
        using var response = await task; Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<AuctionDetails>(Json))!;
    }
    private static async Task<AuctionBidDetails> BidResponse(Task<HttpResponseMessage> task)
    {
        using var response = await task; Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<AuctionBidDetails>(Json))!;
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AuctionPersistsExactResultSelectionAllocationsAndAudit(bool organizer)
    {
        var (s, cycle) = await AuctionReady(organizer); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        var bid = await BidResponse(PlaceBid(member, s, cycle.Id));
        var closed = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")); var result = closed.Result!;
        Assert.Equal("WINNER_SELECTED", closed.Status); Assert.Equal(35000, result.WinnerPayout);
        Assert.Equal(750, result.GrossMemberShare); Assert.Equal(750, result.PlatformFee); Assert.Equal(14250, result.MemberBenefitPool);
        Assert.Equal(result.WinningDiscount, result.MemberBenefitPool + result.PlatformFee);
        Assert.Equal("CALCULATED_PENDING_SETTLEMENT", result.AllocationStatus); Assert.Equal("DHANVI_AUCTION_V1", result.CalculationVersion);
        Assert.Equal(20, result.Allocations.Count); Assert.DoesNotContain(result.Allocations, a => a.MembershipId == result.Winner.MembershipId);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var stored = await db.AuctionResults.SingleAsync(r => r.CycleId == cycle.Id);
        var selection = await db.SelectionResults.Include(r => r.EligibleMembers).SingleAsync(r => r.Id == stored.SelectionResultId);
        Assert.Equal(SelectionMethod.Auction, selection.SelectionMethod); Assert.Equal(result.Winner.MembershipId, selection.WinnerMembershipId);
        Assert.Equal(20, selection.EligibleMembers.Count); Assert.Equal("DHANVI_AUCTION_V1", selection.AlgorithmVersion); Assert.Null(selection.SeedReveal);
        var winner = await db.Memberships.SingleAsync(m => m.Id == selection.WinnerMembershipId); Assert.True(winner.HasBeenSelectedForPayout);
        var completed = await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id);
        Assert.Equal(CycleStatus.SelectionCompleted, completed.Status); Assert.Equal(selection.Id, completed.SelectionResultId);
        Assert.All(await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId && c.Id != cycle.Id).ToListAsync(), c => Assert.Equal(CycleStatus.Upcoming, c.Status));
        Assert.Equal(20, await db.ContributionEntries.CountAsync(e => db.Contributions.Any(c => c.Id == e.ContributionId && c.GroupId == s.GroupId)));
        Assert.Equal(10, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.AlgorithmVersion == "DHANVI_AUCTION_V1"));
        var replay = await BidResponse(PlaceBid(member, s, cycle.Id)); Assert.Equal(bid, replay);
        var ownResult = (await member.GetFromJsonAsync<AuctionResultDetails>(AuctionPath(s, cycle.Id) + "/result", Json))!;
        Assert.Empty(ownResult.Allocations); Assert.Equal(0, ownResult.MyBenefitAllocation);
        using var other = Client(s.MemberIds[1]); var benefit = (await other.GetFromJsonAsync<AuctionResultDetails>(AuctionPath(s, cycle.Id) + "/result", Json))!;
        Assert.Equal(750, benefit.MyBenefitAllocation);
        using var late = await PlaceBid(other, s, cycle.Id, 15500); Assert.Contains("AUCTION_CLOSED", await late.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AuctionBidReplaySurvivesOutbidAndHistoryStaysPrivate()
    {
        var (s, cycle) = await AuctionReady(); using var member = Client(s.MemberIds[0]); using var other = Client(s.MemberIds[1]);
        var first = await BidResponse(PlaceBid(member, s, cycle.Id)); await BidResponse(PlaceBid(other, s, cycle.Id, 15500));
        Assert.Equal(first, await BidResponse(PlaceBid(member, s, cycle.Id)));
        using var reused = await PlaceBid(member, s, cycle.Id, 16000); Assert.Equal(HttpStatusCode.Conflict, reused.StatusCode);
        Assert.Contains("IDEMPOTENCY_KEY_REUSED", await reused.Content.ReadAsStringAsync());
        var mine = (await member.GetFromJsonAsync<AuctionBidDetails[]>(AuctionPath(s, cycle.Id) + "/my-bids", Json))!;
        Assert.Single(mine); Assert.Equal(first.BidId, mine[0].BidId); Assert.False(mine[0].IsCurrentWinningBid); Assert.Null(mine[0].MemberSlot);
        var details = (await member.GetFromJsonAsync<AuctionDetails>(AuctionPath(s, cycle.Id), Json))!;
        Assert.Empty(details.OperationalBids); Assert.Empty(details.AuditHistory); Assert.Equal(15500, details.CurrentHighestDiscount);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ConcurrentAuctionBidsSerializeSequenceAndIdempotency(bool sameKey)
    {
        var (s, cycle) = await AuctionReady(); using var member = Client(s.MemberIds[0]);
        var responses = await Task.WhenAll(PlaceBid(member, s, cycle.Id, 15000, "one"), PlaceBid(member, s, cycle.Id, sameKey ? 15000 : 15500, sameKey ? "one" : "two"));
        try
        {
            Assert.Contains(responses, r => r.IsSuccessStatusCode);
            foreach (var rejected in responses.Where(r => !r.IsSuccessStatusCode))
            {
                Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
                Assert.Contains("BID_INCREMENT_NOT_MET", await rejected.Content.ReadAsStringAsync());
            }
            if (sameKey)
            {
                Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode));
                Assert.Equal(await responses[0].Content.ReadFromJsonAsync<AuctionBidDetails>(Json), await responses[1].Content.ReadFromJsonAsync<AuctionBidDetails>(Json));
            }
            using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            var bids = await db.AuctionBids.Where(b => b.CycleId == cycle.Id).OrderBy(b => b.SequenceNumber).ToListAsync();
            Assert.Equal(Enumerable.Range(1, bids.Count).Select(i => (long)i), bids.Select(b => b.SequenceNumber));
            Assert.Equal(sameKey ? 15000 : 15500, bids[^1].DiscountAmount);
            var auction = await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id);
            Assert.Equal(bids.Count, auction.LastBidSequence); Assert.Equal(bids[^1].Id, auction.CurrentWinningBidId);
            Assert.Equal(sameKey ? 1 : responses.Count(r => r.IsSuccessStatusCode), bids.Count);
        }
        finally { foreach (var response in responses) response.Dispose(); }
    }

    private static async Task WaitForAuctionLockWaiters(GroupsDbContext db, int count)
    {
        var timeout = Stopwatch.StartNew();
        while (timeout.Elapsed < TimeSpan.FromSeconds(15))
        {
            var waiting = await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0").SingleAsync();
            if (waiting >= count) return;
            await Task.Delay(20);
        }
        Assert.Fail("Auction requests did not reach PostgreSQL row-lock waits.");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AuctionBidVersusCloseObeysPostgreSqlLockOrder(bool bidFirst)
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {s.GroupId} FOR UPDATE").SingleAsync();
        var first = bidFirst ? PlaceBid(member, s, cycle.Id) : ManageAuction(owner, s, cycle.Id, "close");
        await WaitForAuctionLockWaiters(db, 1);
        var second = bidFirst ? ManageAuction(owner, s, cycle.Id, "close") : PlaceBid(member, s, cycle.Id);
        await WaitForAuctionLockWaiters(db, 2);
        Assert.False(first.IsCompleted); Assert.False(second.IsCompleted);
        await tx.CommitAsync();
        using var firstResponse = await first; using var secondResponse = await second;
        using var checkScope = fixture.Factory.Services.CreateScope(); var check = checkScope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var auction = await check.Auctions.SingleAsync(a => a.CycleId == cycle.Id);
        if (bidFirst)
        {
            Assert.True(firstResponse.IsSuccessStatusCode, await firstResponse.Content.ReadAsStringAsync());
            Assert.True(secondResponse.IsSuccessStatusCode, await secondResponse.Content.ReadAsStringAsync());
            Assert.Equal(AuctionStatus.WinnerSelected, auction.Status); Assert.Equal(1, await check.AuctionBids.CountAsync(b => b.CycleId == cycle.Id));
            Assert.Equal(15000, (await check.AuctionResults.SingleAsync(r => r.CycleId == cycle.Id)).WinningDiscount);
        }
        else
        {
            Assert.True(firstResponse.IsSuccessStatusCode, await firstResponse.Content.ReadAsStringAsync());
            Assert.Contains("AUCTION_CLOSED", await secondResponse.Content.ReadAsStringAsync());
            Assert.Equal(AuctionStatus.ClosedNoBids, auction.Status); Assert.False(await check.AuctionBids.AnyAsync(b => b.CycleId == cycle.Id));
            Assert.False(await check.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id));
        }
    }

    [Fact]
    public async Task DuplicateAuctionCloseCreatesOneResult()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        await BidResponse(PlaceBid(member, s, cycle.Id));
        var results = await Task.WhenAll(AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")), AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")));
        Assert.Equal(results[0].Result!.Id, results[1].Result!.Id);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.Equal(1, await db.AuctionResults.CountAsync(r => r.CycleId == cycle.Id));
        Assert.Equal(20, await db.AuctionBenefitAllocations.CountAsync(a => a.GroupId == s.GroupId));
        Assert.Equal(1, await db.AuditEvents.CountAsync(a => a.CycleId == cycle.Id && a.Action == "AUCTION_CLOSED"));
    }

    [Fact]
    public async Task AuctionEmptyCloseRemainsUnresolvedAndCannotReopen()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s);
        var result = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close"));
        Assert.Equal("CLOSED_NO_BIDS", result.Status); Assert.Null(result.Result);
        Assert.Equal("CLOSED_NO_BIDS", (await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close"))).Status);
        using var reopen = await ManageAuction(owner, s, cycle.Id, "open"); Assert.Contains("AUCTION_ALREADY_EXISTS", await reopen.Content.ReadAsStringAsync());
        using var missing = await owner.GetAsync(AuctionPath(s, cycle.Id) + "/result"); Assert.Contains("AUCTION_HAS_NO_BIDS", await missing.Content.ReadAsStringAsync());
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.Equal(CycleStatus.ReadyForSelection, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
        Assert.False(await db.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id));
        Assert.False(await db.AuctionBenefitAllocations.AnyAsync(a => a.GroupId == s.GroupId));
    }

    [Theory]
    [InlineData(GroupType.Random, false)]
    [InlineData(GroupType.Auction, true)]
    public async Task AuctionOpenRejectsRandomAndOrganizerReservedCycles(GroupType type, bool reserved)
    {
        var (s, cycle) = type == GroupType.Auction ? await AuctionReady(true, reserved, false) : await SelectionReady();
        using var owner = Owner(s); using var response = await ManageAuction(owner, s, cycle.Id, "open");
        Assert.Contains("CYCLE_NOT_AUCTION", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AuctionManagementAndMemberAuthorizationAreEnforced()
    {
        var (s, cycle) = await AuctionReady(true, open: false); var unrelated = await Seed(organizer: true);
        using var stranger = Owner(unrelated); using var denied = await ManageAuction(stranger, s, cycle.Id, "open");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var owner = Owner(s); await AuctionResponse(ManageAuction(owner, s, cycle.Id, "open"));
        using var nonmember = await PlaceBid(stranger, s, cycle.Id); Assert.Equal(HttpStatusCode.Forbidden, nonmember.StatusCode);
        using var history = await stranger.GetAsync(AuctionPath(s, cycle.Id)); Assert.Equal(HttpStatusCode.Forbidden, history.StatusCode);
        using var member = Client(s.MemberIds[0]); using var close = await ManageAuction(member, s, cycle.Id, "close"); Assert.Equal(HttpStatusCode.Forbidden, close.StatusCode);
    }

    [Fact]
    public async Task AuctionRechecksPriorWinnersAndContributionReversal()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            var prior = await db.Memberships.SingleAsync(m => m.GroupId == s.GroupId && m.UserId == s.MemberIds[0]); prior.SelectForPayout(1, fixture.Clock.UtcNow); await db.SaveChangesAsync();
        }
        using var previous = await PlaceBid(member, s, cycle.Id); Assert.Contains("MEMBER_ALREADY_SELECTED_FOR_PAYOUT", await previous.Content.ReadAsStringAsync());
        var row = (await Rows(owner, s, cycle.Id)).Single(r => r.MembershipId != Guid.Empty && r.SlotNumber == 2);
        await Result(Operation(owner, s, row, new ReverseContributionRequest(row.Entries[0].Id, "Correction"), "reverse", true));
        using var other = Client(s.MemberIds[1]); using var incomplete = await PlaceBid(other, s, cycle.Id);
        Assert.Contains("MEMBER_NOT_ELIGIBLE_TO_BID", await incomplete.Content.ReadAsStringAsync());
        using var blockedClose = await ManageAuction(owner, s, cycle.Id, "close"); Assert.Contains("CYCLE_NOT_READY_FOR_SELECTION", await blockedClose.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("0", "INVALID_DISCOUNT")]
    [InlineData("4999", "DISCOUNT_BELOW_MINIMUM")]
    [InlineData("20500", "DISCOUNT_ABOVE_MAXIMUM")]
    [InlineData("50000", "INVALID_DISCOUNT")]
    [InlineData("5000.01", "INVALID_AUCTION_ALLOCATION_PRECISION")]
    [InlineData("5000.001", "INVALID_DISCOUNT")]
    public async Task AuctionRejectsInvalidDiscountWithoutPersistingBid(string input, string code)
    {
        var (s, cycle) = await AuctionReady(); using var member = Client(s.MemberIds[0]);
        using var invalid = await PlaceBid(member, s, cycle.Id, decimal.Parse(input, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Contains(code, await invalid.Content.ReadAsStringAsync());
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.False(await db.AuctionBids.AnyAsync(b => b.CycleId == cycle.Id));
        Assert.Equal(0, (await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id)).LastBidSequence);
    }

    [Fact]
    public async Task AuctionSameMemberCanIncreaseButNotCancelOrRewriteHistory()
    {
        var (s, cycle) = await AuctionReady(); using var member = Client(s.MemberIds[0]);
        var first = await BidResponse(PlaceBid(member, s, cycle.Id, 5000, "first"));
        using var low = await PlaceBid(member, s, cycle.Id, 5499, "low"); Assert.Contains("BID_INCREMENT_NOT_MET", await low.Content.ReadAsStringAsync());
        var second = await BidResponse(PlaceBid(member, s, cycle.Id, 5500, "second")); Assert.Equal(2, second.SequenceNumber);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionBids.Where(b => b.Id == first.BidId).ExecuteUpdateAsync(set => set.SetProperty(b => b.DiscountAmount, 10000)));
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionBids.Where(b => b.Id == first.BidId).ExecuteDeleteAsync());
        Assert.Equal(5000, (await db.AuctionBids.SingleAsync(b => b.Id == first.BidId)).DiscountAmount);
    }

    [Fact]
    public async Task AuctionResultAllocationsAndTerminalStateAreImmutable()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        await BidResponse(PlaceBid(member, s, cycle.Id)); var closed = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close"));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionResults.Where(r => r.Id == closed.Result!.Id).ExecuteUpdateAsync(set => set.SetProperty(r => r.FinalizedAt, fixture.Clock.UtcNow.AddMinutes(1))));
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionResults.Where(r => r.Id == closed.Result!.Id).ExecuteDeleteAsync());
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionBenefitAllocations.Where(a => a.GroupId == s.GroupId).ExecuteDeleteAsync());
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.AuctionBenefitAllocations.Where(a => a.GroupId == s.GroupId).ExecuteUpdateAsync(set => set.SetProperty(a => a.Amount, 1)));
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Auctions.Where(a => a.CycleId == cycle.Id).ExecuteUpdateAsync(set => set.SetProperty(a => a.Status, AuctionStatus.Open)));
        var auction = await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id);
        var membership = await db.Memberships.SingleAsync(m => m.GroupId == s.GroupId && m.UserId == s.MemberIds[1]);
        db.AuctionBids.Add(new(auction.Id, s.GroupId, cycle.Id, membership.Id, 15500, 2, "late-insert", fixture.Clock.UtcNow));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task AuctionFinalizationFailureRollsBackEveryWrite()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        await BidResponse(PlaceBid(member, s, cycle.Id));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var name = $"fail_auction_{s.GroupId:N}";
        var sql = $$"""
            CREATE FUNCTION groups.{{name}}() RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN IF NEW."GroupId" = '{{s.GroupId}}'::uuid THEN RAISE EXCEPTION 'Injected allocation failure'; END IF; RETURN NEW; END; $body$;
            CREATE TRIGGER {{name}} BEFORE INSERT ON groups."AuctionBenefitAllocations" FOR EACH ROW EXECUTE FUNCTION groups.{{name}}();
            """;
        await db.Database.ExecuteSqlRawAsync(sql);
        try
        {
            using var failed = await ManageAuction(owner, s, cycle.Id, "close"); Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
            Assert.False(await db.AuctionResults.AnyAsync(r => r.CycleId == cycle.Id));
            Assert.False(await db.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id));
            Assert.False(await db.AuctionBenefitAllocations.AnyAsync(a => a.GroupId == s.GroupId));
            Assert.False(await db.Memberships.AnyAsync(m => m.GroupId == s.GroupId && m.HasBeenSelectedForPayout));
            Assert.Equal(AuctionStatus.Open, (await db.Auctions.SingleAsync(a => a.CycleId == cycle.Id)).Status);
            Assert.Equal(CycleStatus.ReadyForSelection, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
            Assert.False(await db.AuditEvents.AnyAsync(a => a.CycleId == cycle.Id && a.Action == "AUCTION_CLOSED"));
        }
        finally { var cleanup = $"DROP TRIGGER {name} ON groups.\"AuctionBenefitAllocations\"; DROP FUNCTION groups.{name}();"; await db.Database.ExecuteSqlRawAsync(cleanup); }
        Assert.Equal("WINNER_SELECTED", (await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close"))).Status);
    }

    [Fact]
    public async Task AuctionSuspensionBlocksBidsAndCloseButPreservesHistory()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]);
        await BidResponse(PlaceBid(member, s, cycle.Id));
        using var suspend = await owner.PostAsJsonAsync($"/api/v1/admin/groups/{s.GroupId}/suspend", new { reason = "Operational review" });
        suspend.EnsureSuccessStatusCode();
        using var bid = await PlaceBid(member, s, cycle.Id, 15500, "after-suspension");
        Assert.Contains("GROUP_SUSPENDED", await bid.Content.ReadAsStringAsync());
        using var close = await ManageAuction(owner, s, cycle.Id, "close");
        Assert.Contains("GROUP_SUSPENDED", await close.Content.ReadAsStringAsync());
        var history = (await member.GetFromJsonAsync<AuctionDetails>(AuctionPath(s, cycle.Id), Json))!;
        Assert.False(history.CanBid); Assert.Single(history.MyBids); Assert.Null(history.Result);
    }

    [Fact]
    public async Task AuctionCycleTwoExcludesReservedOrganizerButIncludesTheirBenefit()
    {
        var (s, firstCycle) = await AuctionReady(true, true, false); using var owner = Owner(s);
        await Selection(Select(owner, s, firstCycle.Id));
        CycleDetails second;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
            // Test-only setup of a later current cycle. No production cycle advancement is introduced.
            await db.Groups.Where(g => g.Id == s.GroupId).ExecuteUpdateAsync(set => set.SetProperty(g => g.CurrentCycleNumber, 2));
            await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId && c.CycleNumber == 2).ExecuteUpdateAsync(set => set.SetProperty(c => c.Status, CycleStatus.CollectingContributions));
        }
        second = (await owner.GetFromJsonAsync<List<CycleDetails>>($"/api/v1/groups/{s.GroupId}/cycles", Json))!.Single(c => c.CycleNumber == 2);
        foreach (var row in await Rows(owner, s, second.Id))
            await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "cycle-two", null), row.Id.ToString()));
        fixture.Clock.UtcNow = new(second.SelectionDate.ToDateTime(new(10, 0)), TimeSpan.Zero);
        var opened = await AuctionResponse(ManageAuction(owner, s, second.Id, "open"));
        Assert.Equal(19, opened.EligibleBidderCount);
        using var previous = await PlaceBid(owner, s, second.Id); Assert.Contains("MEMBER_ALREADY_SELECTED_FOR_PAYOUT", await previous.Content.ReadAsStringAsync());
        using var member = Client(s.MemberIds[1]); await BidResponse(PlaceBid(member, s, second.Id));
        var closed = await AuctionResponse(ManageAuction(owner, s, second.Id, "close"));
        Assert.Equal(750, closed.Result!.MyBenefitAllocation);
        Assert.Equal(19, closed.Result.NonWinnerCount);
        Assert.Equal(35000, closed.Result.WinnerPayout);
    }
}
