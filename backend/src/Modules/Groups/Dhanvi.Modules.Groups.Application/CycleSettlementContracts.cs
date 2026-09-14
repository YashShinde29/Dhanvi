using System.Data.Common;
namespace Dhanvi.Modules.Groups.Application;
public sealed record SettlementRecipient(Guid MembershipId, Guid UserId, string Name);
public sealed record SettlementCycle(Guid GroupId, string GroupName, Guid OwnerId, bool OrganizerCreated, bool Active, Guid CycleId,
    int CycleNumber, string Status, Guid SelectionResultId, string SelectionMethod, IReadOnlyList<SettlementRecipient> Recipients);
public interface ICycleSettlementStore
{
    Task<SettlementCycle> ReadLockedAsync(Guid cycleId, DbTransaction transaction, CancellationToken ct);
    Task<bool> CanInspectAsync(Guid groupId, Guid actor, CancellationToken ct);
    Task CompleteAndOpenNextAsync(Guid cycleId, Guid actor, DbTransaction transaction, DateTimeOffset now, CancellationToken ct);
}
