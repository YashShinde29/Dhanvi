using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.SharedKernel.Domain;

// Reusable operation receipt. ResultId references an operation result owned by its caller.
public sealed class IdempotencyRecord(string scope, string key, string requestHash, Guid resultId, DateTimeOffset createdAt)
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string Scope { get; private set; } = scope;
    public string Key { get; private set; } = key;
    public string RequestHash { get; private set; } = requestHash;
    public Guid ResultId { get; private set; } = resultId;
    public DateTimeOffset CreatedAt { get; private set; } = createdAt;
    public void ValidateReplay(string hash) => BusinessRuleException.Require(RequestHash == hash, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different request. Use a new key for a new operation.");
}
