namespace Dhanvi.Modules.Identity.Application.Abstractions;

public interface IEmailSender
{
    Task SendPasswordResetAsync(string email, string resetToken, CancellationToken cancellationToken);
}

