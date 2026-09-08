namespace Dhanvi.Modules.Identity.Infrastructure.Security;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";
    public string Issuer { get; init; } = "Dhanvi";
    public string Audience { get; init; } = "Dhanvi.Web";
    public string SigningKey { get; init; } = string.Empty;
    public int AccessTokenMinutes { get; init; } = 15;
    public int RefreshTokenDays { get; init; } = 30;
    public int PasswordResetMinutes { get; init; } = 30;
    public bool SecureCookies { get; init; } = true;
}

