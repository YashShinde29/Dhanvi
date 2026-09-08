using Dhanvi.Modules.Identity.Application.Abstractions;
using Microsoft.Extensions.Logging;

namespace Dhanvi.Modules.Identity.Infrastructure.Email;

internal sealed partial class NullEmailSender(ILogger<NullEmailSender> logger) : IEmailSender
{
    public Task SendPasswordResetAsync(string email, string resetToken, CancellationToken cancellationToken)
    {
        LogDeliveryUnavailable(logger, email);
        return Task.CompletedTask;
    }

    [LoggerMessage(EventId = 2100, Level = LogLevel.Information, Message = "Password reset requested for {Email}; no email provider is configured.")]
    private static partial void LogDeliveryUnavailable(ILogger logger, string email);
}

