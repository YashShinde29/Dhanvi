using System.Security.Claims;
using Dhanvi.Modules.RandomDraws.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.RandomDraws.Api;
public static class SelectionEndpoints
{
    public static IEndpointRouteBuilder MapSelectionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var route = endpoints.MapGroup("/groups/{groupId:guid}/cycles/{cycleId:guid}/selection").RequireAuthorization().WithTags("Selection");
        route.MapPost("", (Guid groupId, Guid cycleId, ClaimsPrincipal p, ISelectionService s, CancellationToken ct) => s.ExecuteAsync(groupId, cycleId, Actor(p), ct));
        route.MapGet("", (Guid groupId, Guid cycleId, ClaimsPrincipal p, ISelectionService s, CancellationToken ct) => s.GetAsync(groupId, cycleId, Actor(p), ct));
        route.MapGet("/preview", (Guid groupId, Guid cycleId, ClaimsPrincipal p, ISelectionService s, CancellationToken ct) => s.PreviewAsync(groupId, cycleId, Actor(p), ct));
        route.MapGet("/verify", (Guid groupId, Guid cycleId, ClaimsPrincipal p, ISelectionService s, CancellationToken ct) => s.VerifyAsync(groupId, cycleId, Actor(p), ct));
        return endpoints;
    }
    private static SelectionActor Actor(ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? new(id, p.IsInRole("ADMIN") || p.IsInRole("SUPER_ADMIN")) : throw new UnauthorizedAccessException();
}
