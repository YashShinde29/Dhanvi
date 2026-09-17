using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Auctions.Application;
namespace Dhanvi.IntegrationTests.Api;

// Member auction read model: live movement without identities, own-bid flags and leader position.
public sealed partial class CycleEndpointTests
{
    [Fact] public async Task AuctionReadModelExposesGroupFactsRecentBidsAndLeaderWithoutIdentities()
    {
        var (s, cycle) = await AuctionReady(count: 4); using var a = Client(s.MemberIds[0]); using var b = Client(s.MemberIds[1]); using var c = Client(s.MemberIds[2]);
        await BidResponse(PlaceBid(a, s, cycle.Id, 6000, "a1")); await BidResponse(PlaceBid(b, s, cycle.Id, 8000, "b1")); await BidResponse(PlaceBid(c, s, cycle.Id, 10000, "c1"));
        var view = (await a.GetFromJsonAsync<AuctionDetails>($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/auction", Json))!;
        Assert.Equal(50000m, view.GroupValue); Assert.Equal("Cycle integration group", view.GroupName); Assert.Equal(4, view.DurationMonths);
        Assert.NotNull(view.RecentBids); Assert.Equal(3, view.RecentBids!.Count);
        Assert.Equal(10000m, view.RecentBids[0].DiscountAmount); Assert.True(view.RecentBids[0].IsCurrentHighest); Assert.False(view.RecentBids[0].IsMine);
        Assert.Equal(6000m, view.RecentBids[2].DiscountAmount); Assert.True(view.RecentBids[2].IsMine); Assert.False(view.RecentBids[2].IsCurrentHighest);
        Assert.All(view.RecentBids, r => Assert.InRange(r.MemberSlot, 1, 4));
        Assert.Equal(view.RecentBids[0].MemberSlot, view.CurrentLeaderSlot);
        Assert.Empty(view.OperationalBids); Assert.Single(view.MyBids); Assert.False(view.MyBids[0].IsCurrentWinningBid);
        var raw = await a.GetStringAsync($"/api/v1/groups/{s.GroupId}/cycles/{cycle.Id}/auction");
        Assert.DoesNotContain("@cycle.test", raw); Assert.DoesNotContain("\"email\"", raw, StringComparison.OrdinalIgnoreCase);
        // A stale bid (below current + increment) is rejected with the increment code the UI turns into "the auction moved".
        using var stale = await PlaceBid(a, s, cycle.Id, 10000, "a2"); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode); Assert.Contains("BID_INCREMENT_NOT_MET", await stale.Content.ReadAsStringAsync());
    }
}
