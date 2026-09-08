using Dhanvi.Modules.Audit.Application;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;

namespace Dhanvi.Modules.Audit.Infrastructure;

public sealed class AuditWriter(AuditDbContext dbContext) : IAuditWriter
{
    public void Add(Guid? actorUserId, string action, string entityType, string entityId, DateTimeOffset timestamp, string? correlationId) =>
        dbContext.AuditLogs.Add(AuditLog.Create(actorUserId, action, entityType, entityId, timestamp, correlationId));

    public Task SaveChangesAsync(CancellationToken cancellationToken) => dbContext.SaveChangesAsync(cancellationToken);
}

