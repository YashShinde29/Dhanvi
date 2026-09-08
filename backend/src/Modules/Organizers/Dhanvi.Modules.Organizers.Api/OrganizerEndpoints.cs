using System.Security.Claims;
using Dhanvi.Modules.Identity.Application;
using Dhanvi.Modules.Organizers.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dhanvi.Modules.Organizers.Api;

public static class OrganizerEndpoints
{
    public static IEndpointRouteBuilder MapOrganizerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var organizers = endpoints.MapGroup("/organizers").WithTags("Organizers").RequireAuthorization(AuthorizationPolicies.AuthenticatedUser);
        organizers.MapPost("/apply", async (ApplyForOrganizerRequest request, IOrganizerService service, ClaimsPrincipal principal, HttpContext context, CancellationToken cancellationToken) =>
            Results.Ok(await service.ApplyAsync(GetUserId(principal), request, context.TraceIdentifier, cancellationToken)));
        organizers.MapGet("/me", async (IOrganizerService service, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMyStatusAsync(GetUserId(principal), cancellationToken)));

        var admin = endpoints.MapGroup("/admin").WithTags("Administration").RequireAuthorization(AuthorizationPolicies.AdminOnly);
        admin.MapGet("/organizer-applications", async (int? page, int? pageSize, string? status, string? search, IOrganizerService service, CancellationToken cancellationToken) =>
            Results.Ok(await service.GetApplicationsAsync(page ?? 1, pageSize ?? 20, status, search, cancellationToken)));
        admin.MapPost("/organizer-applications/{applicationId:guid}/approve", async (Guid applicationId, IOrganizerService service, ClaimsPrincipal principal, HttpContext context, CancellationToken cancellationToken) =>
        {
            await service.ApproveAsync(applicationId, GetUserId(principal), context.TraceIdentifier, cancellationToken);
            return Results.NoContent();
        });
        admin.MapPost("/organizer-applications/{applicationId:guid}/reject", async (Guid applicationId, RejectOrganizerApplicationRequest request, IOrganizerService service, ClaimsPrincipal principal, HttpContext context, CancellationToken cancellationToken) =>
        {
            await service.RejectAsync(applicationId, GetUserId(principal), request.Reason, context.TraceIdentifier, cancellationToken);
            return Results.NoContent();
        });
        admin.MapPost("/organizers/{userId:guid}/suspend", async (Guid userId, IOrganizerService service, ClaimsPrincipal principal, HttpContext context, CancellationToken cancellationToken) =>
        {
            await service.SuspendAsync(userId, GetUserId(principal), context.TraceIdentifier, cancellationToken);
            return Results.NoContent();
        });
        return endpoints;
    }

    private static Guid GetUserId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId : throw new UnauthorizedAccessException();
}

