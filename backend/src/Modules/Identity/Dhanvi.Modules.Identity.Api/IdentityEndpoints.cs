using System.Security.Claims;
using Dhanvi.Modules.Identity.Application;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Identity.Application.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;

namespace Dhanvi.Modules.Identity.Api;

public static class IdentityEndpoints
{
    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/auth").WithTags("Authentication");
        auth.MapPost("/register", async (RegisterRequest request, IIdentityService service, HttpContext context, CancellationToken cancellationToken) =>
            Results.Ok(await service.RegisterAsync(request, ClientIp(context), context.TraceIdentifier, cancellationToken)));
        auth.MapPost("/login", async (LoginRequest request, IIdentityService service, HttpContext context, IConfiguration configuration, CancellationToken cancellationToken) =>
        {
            var response = await service.LoginAsync(request, ClientIp(context), context.TraceIdentifier, cancellationToken);
            AuthenticationCookies.Write(context, configuration, response);
            return Results.Ok(response);
        }).RequireRateLimiting("authentication");
        auth.MapPost("/refresh", async (RefreshRequest request, IIdentityService service, HttpContext context, IConfiguration configuration, CancellationToken cancellationToken) =>
        {
            var token = request.RefreshToken ?? context.Request.Cookies[AuthenticationCookies.RefreshCookie];
            if (string.IsNullOrWhiteSpace(token)) return Results.Unauthorized();
            var response = await service.RefreshAsync(token, ClientIp(context), context.TraceIdentifier, cancellationToken);
            AuthenticationCookies.Write(context, configuration, response);
            return Results.Ok(response);
        });
        auth.MapPost("/logout", async (LogoutRequest request, IIdentityService service, HttpContext context, CancellationToken cancellationToken) =>
        {
            var token = request.RefreshToken ?? context.Request.Cookies[AuthenticationCookies.RefreshCookie];
            if (!string.IsNullOrWhiteSpace(token)) await service.LogoutAsync(token, ClientIp(context), cancellationToken);
            AuthenticationCookies.Clear(context);
            return Results.NoContent();
        });
        auth.MapPost("/forgot-password", async (ForgotPasswordRequest request, IIdentityService service, CancellationToken cancellationToken) =>
        {
            await service.ForgotPasswordAsync(request, cancellationToken);
            return Results.Ok(new MessageResponse("If an account exists, password reset instructions have been sent."));
        }).RequireRateLimiting("password-reset");
        auth.MapPost("/reset-password", async (ResetPasswordRequest request, IIdentityService service, HttpContext context, CancellationToken cancellationToken) =>
        {
            await service.ResetPasswordAsync(request, context.TraceIdentifier, cancellationToken);
            AuthenticationCookies.Clear(context);
            return Results.Ok(new MessageResponse("Password has been reset. Please sign in again."));
        }).RequireRateLimiting("password-reset");

        var users = endpoints.MapGroup("/users").WithTags("Users").RequireAuthorization(AuthorizationPolicies.AuthenticatedUser);
        users.MapGet("/me", async (IIdentityService service, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
            Results.Ok(await service.GetCurrentUserAsync(GetUserId(principal), cancellationToken)));
        users.MapPut("/me", async (UpdateProfileRequest request, IIdentityService service, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
            Results.Ok(await service.UpdateProfileAsync(GetUserId(principal), request, cancellationToken)));
        users.MapPut("/me/password", async (ChangePasswordRequest request, IIdentityService service, ClaimsPrincipal principal, HttpContext context, CancellationToken cancellationToken) =>
        {
            await service.ChangePasswordAsync(GetUserId(principal), request, context.TraceIdentifier, cancellationToken);
            AuthenticationCookies.Clear(context);
            return Results.NoContent();
        });
        return endpoints;
    }

    private static Guid GetUserId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId : throw new UnauthorizedAccessException();

    private static string? ClientIp(HttpContext context) => context.Connection.RemoteIpAddress?.ToString();
}

internal static class AuthenticationCookies
{
    public const string AccessCookie = "dhanvi_access";
    public const string RefreshCookie = "dhanvi_refresh";

    public static void Write(HttpContext context, IConfiguration configuration, AuthenticationResponse response)
    {
        var secure = configuration.GetValue("Jwt:SecureCookies", true);
        var common = new CookieOptions { HttpOnly = true, Secure = secure, SameSite = SameSiteMode.Strict, Path = "/", IsEssential = true };
        context.Response.Cookies.Append(AccessCookie, response.AccessToken, new CookieOptions
        {
            HttpOnly = common.HttpOnly, Secure = common.Secure, SameSite = common.SameSite, Path = common.Path,
            IsEssential = true, MaxAge = TimeSpan.FromSeconds(response.ExpiresIn),
        });
        context.Response.Cookies.Append(RefreshCookie, response.RefreshToken, new CookieOptions
        {
            HttpOnly = common.HttpOnly, Secure = common.Secure, SameSite = common.SameSite, Path = common.Path,
            IsEssential = true, MaxAge = TimeSpan.FromDays(configuration.GetValue("Jwt:RefreshTokenDays", 30)),
        });
    }

    public static void Clear(HttpContext context)
    {
        context.Response.Cookies.Delete(AccessCookie, new CookieOptions { Path = "/" });
        context.Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = "/" });
    }
}
