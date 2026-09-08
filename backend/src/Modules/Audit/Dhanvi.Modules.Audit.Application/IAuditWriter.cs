namespace Dhanvi.Modules.Audit.Application;

public interface IAuditWriter
{
    void Add(Guid? actorUserId, string action, string entityType, string entityId, DateTimeOffset timestamp, string? correlationId);
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

