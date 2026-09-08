using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Identity.Domain.Tokens;

public enum RefreshTokenState { Active, Expired, Revoked }

public sealed class RefreshToken : Entity<Guid>
{
    private RefreshToken() : base(Guid.Empty) { }
    private RefreshToken(Guid id, Guid userId, string tokenHash, DateTimeOffset expiresAt, DateTimeOffset createdAt, string? createdByIp) : base(id) =>
        (UserId, TokenHash, ExpiresAt, CreatedAt, CreatedByIp) = (userId, tokenHash, expiresAt, createdAt, createdByIp);

    public Guid UserId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    public Guid? ReplacedByTokenId { get; private set; }
    public string? CreatedByIp { get; private set; }
    public string? RevokedByIp { get; private set; }

    public RefreshTokenState State(DateTimeOffset now) => RevokedAt.HasValue ? RefreshTokenState.Revoked : ExpiresAt <= now ? RefreshTokenState.Expired : RefreshTokenState.Active;
    public static RefreshToken Create(Guid userId, string tokenHash, DateTimeOffset expiresAt, DateTimeOffset now, string? ip) => new(Guid.NewGuid(), userId, tokenHash, expiresAt, now, ip);

    public void Revoke(DateTimeOffset now, string? ip, Guid? replacementId = null)
    {
        if (RevokedAt.HasValue) return;
        RevokedAt = now;
        RevokedByIp = ip;
        ReplacedByTokenId = replacementId;
    }
}

