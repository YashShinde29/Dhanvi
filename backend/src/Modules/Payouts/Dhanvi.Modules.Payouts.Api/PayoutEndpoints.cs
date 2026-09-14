using System.Security.Claims;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Payouts.Api;
public static class PayoutEndpoints
{
    public static IEndpointRouteBuilder MapPayoutEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/admin/payouts").RequireAuthorization("AdminOnly").WithTags("Admin Payouts");
        admin.MapGet("/", (ClaimsPrincipal user, IPayoutService s, int? page, Guid? groupId, Guid? cycleId, DateTimeOffset? from, DateTimeOffset? to, PayoutStatus? status, PayoutType? type, CancellationToken ct) => s.ListAsync(User(user), true, groupId, page ?? 1, status, type, ct, new(cycleId, from, to)));
        admin.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.DetailsAsync(id, User(user), true, ct));
        admin.MapPost("/{id:guid}/approve", (Guid id, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.ApproveAsync(id, User(user), true, ct));
        admin.MapPost("/{id:guid}/execute", (Guid id, HttpContext h, IPayoutService s, CancellationToken ct) => s.ExecuteAsync(id, User(h.User), true, h.Request.Headers["Idempotency-Key"].ToString(), false, ct));
        admin.MapPost("/{id:guid}/retry", (Guid id, HttpContext h, IPayoutService s, CancellationToken ct) => s.ExecuteAsync(id, User(h.User), true, h.Request.Headers["Idempotency-Key"].ToString(), true, ct));
        admin.MapPost("/{id:guid}/reconcile", (Guid id, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.ReconcileAsync(id, User(user), true, ct));
        endpoints.MapPost("/admin/cycles/{cycleId:guid}/prepare-settlement", (Guid cycleId, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.PrepareCycleSettlementAsync(cycleId, User(user), true, ct)).RequireAuthorization("AdminOnly");
        endpoints.MapPost("/admin/cycles/{cycleId:guid}/evaluate-settlement", (Guid cycleId, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.EvaluateCycleSettlementAsync(cycleId, User(user), true, ct)).RequireAuthorization("AdminOnly");
        var me = endpoints.MapGroup("/me/payouts").RequireAuthorization().WithTags("My Payouts");
        me.MapGet("/", (ClaimsPrincipal user, IPayoutService s, int? page, PayoutStatus? status, PayoutType? type, CancellationToken ct) => s.ListAsync(User(user), false, null, page ?? 1, status, type, ct));
        me.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.DetailsAsync(id, User(user), false, ct));
        endpoints.MapGet("/organizer/groups/{groupId:guid}/payouts", (Guid groupId, ClaimsPrincipal user, IPayoutService s, int? page, CancellationToken ct) => s.ListAsync(User(user), false, groupId, page ?? 1, null, null, ct)).RequireAuthorization("OrganizerOnly");
        endpoints.MapGet("/users/me/payout-account", (ClaimsPrincipal user, IPayoutService s, CancellationToken ct) => s.AccountAsync(User(user), ct)).RequireAuthorization();
        endpoints.MapPost("/users/me/payout-account", async (PayoutAccountRequest request, ClaimsPrincipal user, IIdentityService identity, IPayoutService s, CancellationToken ct) => {
            await identity.VerifyPasswordAsync(User(user), request.Password, ct); return await s.AddAccountAsync(User(user), request, ct);
        }).RequireAuthorization().RequireRateLimiting("authentication");
        return endpoints;
    }
    private static Guid User(ClaimsPrincipal user) => Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : throw new UnauthorizedAccessException();
}
