using System.Security.Claims;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Groups.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Groups.Api;

public static class CycleEndpoints
{
    public static IEndpointRouteBuilder MapCycleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var groups = endpoints.MapGroup("/groups").WithTags("Cycles and contributions").RequireAuthorization();
        groups.MapPost("/{groupId:guid}/activate", (Guid groupId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.ActivateAsync(groupId, Actor(p), ct));
        groups.MapGet("/{groupId:guid}/cycles", (Guid groupId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.CyclesAsync(groupId, Actor(p), false, ct));
        groups.MapGet("/{groupId:guid}/cycles/{cycleId:guid}", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.CycleAsync(groupId, cycleId, Actor(p), ct));
        groups.MapGet("/{groupId:guid}/my-contributions", (Guid groupId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.MyGroupContributionsAsync(groupId, Actor(p), ct));
        endpoints.MapGet("/me/contributions", (Guid? groupId, string? status, int? page, int? pageSize, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) =>
        {
            ContributionStatus? parsed = null;
            if (!string.IsNullOrEmpty(status)) parsed = Enum.TryParse<ContributionStatus>(status, true, out var value) && Enum.IsDefined(value) ? value : throw new BadHttpRequestException("Invalid contribution status.");
            return s.MyContributionsAsync(Actor(p), groupId, parsed, page ?? 1, pageSize ?? 20, ct);
        }).RequireAuthorization().WithTags("My contributions");
        foreach (var scope in new[] { "organizer", "admin" })
        {
            var route = endpoints.MapGroup($"/{scope}/groups").RequireAuthorization(scope == "admin" ? "AdminOnly" : "OrganizerOnly").WithTags($"{scope} contributions");
            route.MapGet("/{groupId:guid}/cycles", (Guid groupId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.CyclesAsync(groupId, Actor(p), true, ct));
            route.MapGet("/{groupId:guid}/cycles/{cycleId:guid}/contributions", (Guid groupId, Guid cycleId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => s.ContributionsAsync(groupId, cycleId, Actor(p), ct));
            route.MapPost("/{groupId:guid}/cycles/{cycleId:guid}/contributions/{contributionId:guid}/record", (Guid groupId, Guid cycleId, Guid contributionId, RecordContributionRequest request, HttpContext h, IContributionRecordingService s, CancellationToken ct) =>
                s.RecordAsync(groupId, cycleId, contributionId, Actor(h.User), h.Request.Headers["Idempotency-Key"].ToString(), request, ct));
            route.MapPost("/{groupId:guid}/cycles/{cycleId:guid}/contributions/{contributionId:guid}/reverse", (Guid groupId, Guid cycleId, Guid contributionId, ReverseContributionRequest request, HttpContext h, IContributionRecordingService s, CancellationToken ct) =>
                s.ReverseAsync(groupId, cycleId, contributionId, Actor(h.User), h.Request.Headers["Idempotency-Key"].ToString(), request, ct));
            route.MapPost("/{groupId:guid}/mark-overdue", async (Guid groupId, ClaimsPrincipal p, IGroupCycleService s, CancellationToken ct) => Results.Ok(new { markedCount = await s.MarkOverdueAsync(groupId, Actor(p), ct) }));
        }
        return endpoints;
    }
    private static GroupActor Actor(ClaimsPrincipal p) => Guid.TryParse(p.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
        ? new(id, p.IsInRole("ADMIN") || p.IsInRole("SUPER_ADMIN")) : throw new UnauthorizedAccessException();
}
