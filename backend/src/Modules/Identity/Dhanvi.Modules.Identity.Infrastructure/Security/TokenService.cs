using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Dhanvi.Modules.Identity.Domain.Users;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Dhanvi.Modules.Identity.Infrastructure.Security;

internal sealed class TokenService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _options = options.Value;

    public int AccessTokenExpiresInSeconds => checked(_options.AccessTokenMinutes * 60);
    public DateTimeOffset RefreshTokenExpiresAt(DateTimeOffset now) => now.AddDays(_options.RefreshTokenDays);
    public DateTimeOffset PasswordResetExpiresAt(DateTimeOffset now) => now.AddMinutes(_options.PasswordResetMinutes);

    public string CreateAccessToken(User user, IReadOnlyCollection<string> roles, DateTimeOffset now)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
        };
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(_options.Issuer, _options.Audience, claims, now.UtcDateTime, now.AddMinutes(_options.AccessTokenMinutes).UtcDateTime, credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static string CreateOpaqueToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(64))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

