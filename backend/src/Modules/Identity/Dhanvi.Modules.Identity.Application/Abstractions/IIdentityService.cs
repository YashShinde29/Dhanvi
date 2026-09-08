using Dhanvi.Modules.Identity.Application.Contracts;

namespace Dhanvi.Modules.Identity.Application.Abstractions;

public interface IIdentityService
{
    Task<RegisteredUserResponse> RegisterAsync(RegisterRequest request, string? ipAddress, string? correlationId, CancellationToken cancellationToken);
    Task<AuthenticationResponse> LoginAsync(LoginRequest request, string? ipAddress, string? correlationId, CancellationToken cancellationToken);
    Task<AuthenticationResponse> RefreshAsync(string refreshToken, string? ipAddress, string? correlationId, CancellationToken cancellationToken);
    Task LogoutAsync(string refreshToken, string? ipAddress, CancellationToken cancellationToken);
    Task<CurrentUserResponse> GetCurrentUserAsync(Guid userId, CancellationToken cancellationToken);
    Task<CurrentUserResponse> UpdateProfileAsync(Guid userId, UpdateProfileRequest request, CancellationToken cancellationToken);
    Task ChangePasswordAsync(Guid userId, ChangePasswordRequest request, string? correlationId, CancellationToken cancellationToken);
    Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken);
    Task ResetPasswordAsync(ResetPasswordRequest request, string? correlationId, CancellationToken cancellationToken);
}

