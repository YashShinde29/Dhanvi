using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Identity.Domain.Tokens;

public sealed class EmailVerificationToken : Entity<Guid>
{
    private EmailVerificationToken() : base(Guid.Empty) { }
    private EmailVerificationToken(Guid id, Guid userId, string hash, DateTimeOffset expiresAt, DateTimeOffset createdAt) : base(id) =>
        (UserId, TokenHash, ExpiresAt, CreatedAt) = (userId, hash, expiresAt, createdAt);

    public Guid UserId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? UsedAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public bool CanUse(DateTimeOffset now) => UsedAt is null && ExpiresAt > now;
    public void MarkUsed(DateTimeOffset now) => UsedAt = now;
    public static EmailVerificationToken Create(Guid userId, string hash, DateTimeOffset expiresAt, DateTimeOffset now) => new(Guid.NewGuid(), userId, hash, expiresAt, now);
}

