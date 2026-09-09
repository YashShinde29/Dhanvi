using System.Security.Claims;
using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.RandomDraws.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Auctions.Api;
public static class AuctionEndpoints
{
    public static IEndpointRouteBuilder MapAuctionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var route = endpoints.MapGroup("/groups/{groupId:guid}/cycles/{cycleId:guid}/auction").RequireAuthorization().WithTags("Auctions");
        route.MapGet("", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IAuctionService s, CancellationToken ct) => s.GetAsync(groupId, cycleId, Actor(p), ct));
        route.MapGet("/my-bids", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IAuctionService s, CancellationToken ct) => s.MyBidsAsync(groupId, cycleId, Actor(p), ct));
        route.MapGet("/result", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IAuctionService s, CancellationToken ct) => s.ResultAsync(groupId, cycleId, Actor(p), ct));
        route.MapPost("/bids", (Guid groupId, Guid cycleId, PlaceAuctionBidRequest request, HttpContext http, IAuctionService s, CancellationToken ct) => s.BidAsync(groupId, cycleId, Actor(http.User), request, http.Request.Headers["Idempotency-Key"].ToString(), ct));
        foreach (var scope in new[] { "organizer", "admin" })
        {
            var management = endpoints.MapGroup($"/{scope}/groups/{{groupId:guid}}/cycles/{{cycleId:guid}}/auction").RequireAuthorization(scope == "admin" ? "AdminOnly" : "OrganizerOnly").WithTags("Auctions");
            management.MapPost("/open", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IAuctionService s, CancellationToken ct) => s.OpenAsync(groupId, cycleId, Actor(p), ct));
            management.MapPost("/close", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IAuctionService s, CancellationToken ct) => s.CloseAsync(groupId, cycleId, Actor(p), ct));
        }
        return endpoints;
    }
    private static SelectionActor Actor(ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? new(id, p.IsInRole("ADMIN") || p.IsInRole("SUPER_ADMIN")) : throw new UnauthorizedAccessException();
}
