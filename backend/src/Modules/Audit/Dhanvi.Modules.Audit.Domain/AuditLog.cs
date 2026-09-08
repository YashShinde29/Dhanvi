using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Audit.Domain;

public sealed class AuditLog : Entity<Guid>
{
    private AuditLog() : base(Guid.Empty) { }
    private AuditLog(Guid id, Guid? actorUserId, string action, string entityType, string entityId, DateTimeOffset timestamp, string? correlationId) : base(id) =>
        (ActorUserId, Action, EntityType, EntityId, Timestamp, CorrelationId) = (actorUserId, action, entityType, entityId, timestamp, correlationId);

    public Guid? ActorUserId { get; private set; }
    public string Action { get; private set; } = string.Empty;
    public string EntityType { get; private set; } = string.Empty;
    public string EntityId { get; private set; } = string.Empty;
    public DateTimeOffset Timestamp { get; private set; }
    public string? CorrelationId { get; private set; }

    public static AuditLog Create(Guid? actorUserId, string action, string entityType, string entityId, DateTimeOffset timestamp, string? correlationId) =>
        new(Guid.NewGuid(), actorUserId, action, entityType, entityId, timestamp, correlationId);
}

