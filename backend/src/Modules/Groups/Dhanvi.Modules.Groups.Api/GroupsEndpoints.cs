using System.Security.Claims;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Groups.Api;

public sealed record GroupReasonRequest(string Reason);
public sealed record AcceptGroupTermsRequest(Guid GroupRuleVersionId, string RulesHash);
public static class GroupsEndpoints
{
    public static IEndpointRouteBuilder MapGroupsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var publicGroups = endpoints.MapGroup("/groups").WithTags("Groups");
        publicGroups.MapGet("", (HttpContext h, IGroupService s, CancellationToken ct) => s.BrowseAsync(Filter(h), Actor(h.User), "public", ct));
        publicGroups.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.DetailsAsync(id, Actor(p), false, ct));
        publicGroups.MapPost("/{id:guid}/applications", async (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), "apply", null, null, null, null, ct); return Results.NoContent(); }).RequireAuthorization();
        publicGroups.MapPost("/{id:guid}/accept-terms", async (Guid id, AcceptGroupTermsRequest r, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), "accept-terms", null, r.GroupRuleVersionId, r.RulesHash, null, ct); return Results.NoContent(); }).RequireAuthorization();
        publicGroups.MapGet("/{id:guid}/organizer/contact", (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.ContactAsync(id, Required(p), ct)).RequireAuthorization();
        publicGroups.MapPost("/{id:guid}/confirm-ready", async (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), "confirm-ready", null, null, null, null, ct); return Results.NoContent(); }).RequireAuthorization();
        endpoints.MapGet("/my-groups", (HttpContext h, IGroupService s, CancellationToken ct) => s.BrowseAsync(Filter(h), Required(h.User), "mine", ct)).RequireAuthorization();
        MapManagement(endpoints, "organizer", GroupCreatorType.Organizer);
        MapManagement(endpoints, "admin", GroupCreatorType.Platform);
        return endpoints;
    }
    private static void MapManagement(IEndpointRouteBuilder endpoints, string scope, GroupCreatorType creator)
    {
        var route = endpoints.MapGroup($"/{scope}/groups").WithTags($"{scope} groups").RequireAuthorization(scope == "admin" ? "AdminOnly" : "OrganizerOnly");
        route.MapGet("", (HttpContext h, IGroupService s, CancellationToken ct) => s.BrowseAsync(Filter(h), Required(h.User), scope, ct));
        route.MapPost("", (SaveGroupRequest r, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.CreateAsync(Required(p), creator, r, ct));
        route.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.DetailsAsync(id, Required(p), true, ct));
        route.MapPut("/{id:guid}", (Guid id, SaveGroupRequest r, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.UpdateAsync(id, Required(p), r, ct));
        foreach (var operation in new[] { "publish", "confirm-ready" })
            route.MapPost($"/{{id:guid}}/{operation}", async (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), operation, null, null, null, null, ct); return Results.NoContent(); });
        foreach (var operation in scope == "admin" ? new[] { "suspend", "cancel" } : new[] { "cancel" })
            route.MapPost($"/{{id:guid}}/{operation}", async (Guid id, GroupReasonRequest r, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), operation, null, null, null, r.Reason, ct); return Results.NoContent(); });
        route.MapGet("/{id:guid}/applications", (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.MembersAsync(id, Required(p), ct));
        route.MapGet("/{id:guid}/members", (Guid id, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => s.MembersAsync(id, Required(p), ct));
        route.MapPost("/{id:guid}/applications/{membershipId:guid}/approve", async (Guid id, Guid membershipId, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), "approve", membershipId, null, null, null, ct); return Results.NoContent(); });
        route.MapPost("/{id:guid}/applications/{membershipId:guid}/reject", async (Guid id, Guid membershipId, GroupReasonRequest r, ClaimsPrincipal p, IGroupService s, CancellationToken ct) => { await s.ExecuteAsync(id, Required(p), "reject", membershipId, null, null, r.Reason, ct); return Results.NoContent(); });
    }
    private static GroupActor? Actor(ClaimsPrincipal p) => p.Identity?.IsAuthenticated == true && Guid.TryParse(p.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? new(id, p.IsInRole("ADMIN") || p.IsInRole("SUPER_ADMIN")) : null;
    private static GroupActor Required(ClaimsPrincipal p) => Actor(p) ?? throw new UnauthorizedAccessException();
    private static GroupFilter Filter(HttpContext h)
    {
        var q = h.Request.Query;
        T? EnumValue<T>(string key) where T : struct, Enum
        {
            if (string.IsNullOrEmpty(q[key])) return null;
            if (Enum.TryParse<T>(q[key].ToString().Replace("_", "", StringComparison.Ordinal), true, out var v) && Enum.IsDefined(v)) return v;
            throw new BadHttpRequestException($"Invalid {key}.");
        }
        decimal? Amount(string key) => string.IsNullOrEmpty(q[key]) ? null : decimal.TryParse(q[key], System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : throw new BadHttpRequestException($"Invalid {key}.");
        int Number(string key, int fallback) => string.IsNullOrEmpty(q[key]) ? fallback : int.TryParse(q[key], out var v) ? v : throw new BadHttpRequestException($"Invalid {key}.");
        return new(EnumValue<GroupType>("groupType"), EnumValue<GroupCreatorType>("creatorType"), EnumValue<GroupStatus>("status"), Amount("minGroupValue"), Amount("maxGroupValue"),
            string.IsNullOrEmpty(q["memberLimit"]) ? null : Number("memberLimit", 20), string.IsNullOrEmpty(q["organizerId"]) ? null : Guid.TryParse(q["organizerId"], out var id) ? id : throw new BadHttpRequestException("Invalid organizerId."),
            Number("page", 1), Number("pageSize", 20), q["sort"], q["search"], q["section"]);
    }
}
