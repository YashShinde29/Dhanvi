using Dhanvi.Modules.Admin.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Admin.Api;

/// <summary>Read-only operational views for the Admin Control Center. No command lives here; commands stay with their modules.</summary>
public static class AdminOperationsEndpoints
{
    public static IEndpointRouteBuilder MapAdminOperationsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/admin").RequireAuthorization("AdminOnly").WithTags("Admin operations");
        admin.MapGet("/operations/overview", (IAdminOperationsService s, CancellationToken ct) => s.OverviewAsync(ct));
        admin.MapGet("/groups/operations", (HttpContext h, IAdminOperationsService s, CancellationToken ct) => s.GroupsAsync(Filter(h), ct));
        admin.MapGet("/groups/{groupId:guid}/operations-summary", (Guid groupId, IAdminOperationsService s, CancellationToken ct) => s.GroupAsync(groupId, ct));
        return endpoints;
    }
    private static AdminGroupOperationsFilter Filter(HttpContext h)
    {
        var q = h.Request.Query;
        string? Text(string key) => string.IsNullOrWhiteSpace(q[key]) ? null : q[key].ToString();
        int Number(string key, int fallback) => string.IsNullOrEmpty(q[key]) ? fallback : int.TryParse(q[key], out var v) ? v : throw new BadHttpRequestException($"Invalid {key}.");
        Guid? organizer = string.IsNullOrEmpty(q["organizerId"]) ? null : Guid.TryParse(q["organizerId"], out var id) ? id : throw new BadHttpRequestException("Invalid organizerId.");
        return new(Text("status"), Text("creatorType"), Text("groupType"), Text("cycleStatus"), organizer, Text("search"), Number("page", 1), Number("pageSize", 25), Text("sort"));
    }
}
