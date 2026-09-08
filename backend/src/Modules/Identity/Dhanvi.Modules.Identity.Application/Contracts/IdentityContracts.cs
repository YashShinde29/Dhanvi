namespace Dhanvi.Modules.Identity.Application.Contracts;

public sealed record RegisterRequest(string FirstName, string LastName, string Email, string? PhoneNumber, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record RefreshRequest(string? RefreshToken);
public sealed record LogoutRequest(string? RefreshToken);
public sealed record ForgotPasswordRequest(string Email);
public sealed record ResetPasswordRequest(string Token, string NewPassword);
public sealed record UpdateProfileRequest(string FirstName, string LastName, string? PhoneNumber);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record RegisteredUserResponse(Guid Id, string FirstName, string LastName, string Email, IReadOnlyCollection<string> Roles);

public sealed record CurrentUserResponse(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    bool EmailVerified,
    bool PhoneVerified,
    IReadOnlyCollection<string> Roles,
    string OrganizerStatus,
    DateTimeOffset CreatedAt);

public sealed record AuthenticationResponse(string AccessToken, string RefreshToken, int ExpiresIn, CurrentUserResponse User);
public sealed record MessageResponse(string Message);

