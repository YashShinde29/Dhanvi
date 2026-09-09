using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Dhanvi.SharedKernel.Exceptions;

namespace Dhanvi.Api.Middleware;

public sealed partial class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, type, message) = exception switch
        {
            Dhanvi.Modules.Groups.Domain.GroupBusinessException group => (group.Code is "NOT_GROUP_OWNER" or "MEMBERSHIP_REQUIRED" or "ORGANIZER_NOT_APPROVED" ? StatusCodes.Status403Forbidden : StatusCodes.Status409Conflict, group.Code, group.Message),
            BadHttpRequestException badRequest => (StatusCodes.Status400BadRequest, "validation_error", badRequest.Message),
            BusinessRuleException cycleRule => (StatusCodes.Status409Conflict, cycleRule.Code, cycleRule.Message),
            RequestValidationException validation => (StatusCodes.Status400BadRequest, "validation_error", validation.Message),
            AuthenticationFailedException authentication => (StatusCodes.Status401Unauthorized, "authentication_error", authentication.Message),
            UnauthorizedAccessException unauthorized => (StatusCodes.Status401Unauthorized, "authentication_error", unauthorized.Message),
            NotFoundException notFound => (StatusCodes.Status404NotFound, "not_found", notFound.Message),
            ConflictException conflict => (StatusCodes.Status409Conflict, "conflict", conflict.Message),
            _ => (StatusCodes.Status500InternalServerError, "server_error", "The request could not be completed."),
        };
        if (status == StatusCodes.Status500InternalServerError)
            LogUnhandledException(logger, exception, httpContext.Request.Method, httpContext.Request.Path);

        var details = new ProblemDetails
        {
            Status = status,
            Type = type,
            Title = message,
            Detail = message,
            Instance = httpContext.Request.Path,
        };
        if (exception is Dhanvi.Modules.Groups.Domain.GroupBusinessException business) details.Extensions["code"] = business.Code;
        if (exception is BusinessRuleException rule) details.Extensions["code"] = rule.Code;
        details.Extensions["traceId"] = httpContext.TraceIdentifier;
        if (exception is RequestValidationException validationException)
            details.Extensions["errors"] = validationException.Errors;
        httpContext.Response.StatusCode = details.Status.Value;
        await httpContext.Response.WriteAsJsonAsync(details, cancellationToken);
        return true;
    }

    [LoggerMessage(EventId = 1000, Level = LogLevel.Error, Message = "Unhandled exception while processing {Method} {Path}")]
    private static partial void LogUnhandledException(ILogger logger, Exception exception, string method, string path);
}
