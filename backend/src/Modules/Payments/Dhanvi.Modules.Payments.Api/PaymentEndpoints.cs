using System.Security.Claims;
using System.Text.Json;
using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Payments.Api;
public static class PaymentEndpoints
{
    public static IEndpointRouteBuilder MapPaymentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/contributions/{contributionId:guid}/payment-eligibility", (Guid contributionId, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) =>
            s.EligibilityAsync(contributionId, User(user), ct)).RequireAuthorization();
        endpoints.MapPost("/contributions/{contributionId:guid}/payments", (Guid contributionId, HttpContext h, IPaymentService s, CancellationToken ct) =>
            s.CreateAsync(contributionId, User(h.User), h.Request.Headers["Idempotency-Key"].ToString(), ct)).RequireAuthorization();
        var member = endpoints.MapGroup("/payments").RequireAuthorization().WithTags("Payments");
        member.MapPost("/{id:guid}/verify", (Guid id, VerifyPaymentRequest request, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) => s.VerifyAsync(id, User(user), request, ct));
        member.MapPost("/{id:guid}/refresh", (Guid id, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) => s.ReconcileAsync(id, User(user), false, ct));
        member.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) => s.DetailsAsync(id, User(user), false, ct));
        member.MapGet("/", (ClaimsPrincipal user, IPaymentService s, int? page, int? pageSize, PaymentStatus? status, CancellationToken ct) => s.ListAsync(User(user), false, page ?? 1, pageSize ?? 20, status, ct));
        var admin = endpoints.MapGroup("/admin/payments").RequireAuthorization("AdminOnly").WithTags("Admin Payments");
        admin.MapGet("/", (ClaimsPrincipal user, IPaymentService s, int? page, int? pageSize, PaymentStatus? status, CancellationToken ct) => s.ListAsync(User(user), true, page ?? 1, pageSize ?? 20, status, ct));
        admin.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) => s.DetailsAsync(id, User(user), true, ct));
        admin.MapPost("/{id:guid}/reconcile", (Guid id, ClaimsPrincipal user, IPaymentService s, CancellationToken ct) => s.ReconcileAsync(id, User(user), true, ct));
        endpoints.MapPost("/payments/webhooks/razorpay", Webhook).AllowAnonymous().WithTags("Payments");
        return endpoints;
    }
    private static Guid User(ClaimsPrincipal user) => Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : throw new UnauthorizedAccessException();
    private static async Task<IResult> Webhook(HttpContext h, IPaymentService service, CancellationToken ct)
    {
        const int limit = 1024 * 1024;
        if (h.Request.ContentLength > limit) return Results.StatusCode(413);
        using var body = new MemoryStream(); var buffer = new byte[8192]; int count;
        while ((count = await h.Request.Body.ReadAsync(buffer, ct)) != 0)
        {
            if (body.Length + count > limit) return Results.StatusCode(413);
            await body.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        try
        {
            await service.ProcessWebhookAsync(body.ToArray(), h.Request.Headers["X-Razorpay-Signature"].ToString(), h.Request.Headers["X-Razorpay-Event-Id"], ct);
            return Results.Ok(new { received = true });
        }
        catch (JsonException) { return Results.BadRequest(new { code = "INVALID_PROVIDER_EVENT" }); }
        catch (KeyNotFoundException) { return Results.BadRequest(new { code = "INVALID_PROVIDER_EVENT" }); }
        catch (HttpRequestException) { return Results.StatusCode(503); }
    }
}
