using System.Data.Common;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;
internal sealed class CycleSettlementStore(GroupsDbContext queries, IGroupUserDirectory users) : ICycleSettlementStore
{
    private static GroupsDbContext Context(DbTransaction tx) => new(new DbContextOptionsBuilder<GroupsDbContext>().UseNpgsql(tx.Connection!).Options);
    public Task<bool> CanInspectAsync(Guid groupId, Guid actor, CancellationToken ct) => queries.Groups.AnyAsync(g => g.Id == groupId && g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == actor, ct);
    public async Task<SettlementCycle> ReadLockedAsync(Guid cycleId, DbTransaction tx, CancellationToken ct)
    {
        await using var db = Context(tx); await db.Database.UseTransactionAsync(tx, ct);
        var groupId = await db.MonthlyCycles.Where(c => c.Id == cycleId).Select(c => (Guid?)c.GroupId).SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Cycle not found.");
        var g = await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {groupId} FOR UPDATE").SingleAsync(ct);
        var c = await db.MonthlyCycles.SingleAsync(c => c.Id == cycleId, ct);
        var recipients = new List<SettlementRecipient>();
        foreach (var m in await db.Memberships.Where(m => m.GroupId == groupId && m.SlotNumber != null).ToArrayAsync(ct))
            recipients.Add(new(m.Id, m.UserId, (await users.FindAsync(m.UserId, ct))?.Name ?? "Member"));
        return new(g.Id, g.Name, g.CreatedByUserId, g.CreatorType == GroupCreatorType.Organizer, g.Status == GroupStatus.Active,
            c.Id, c.CycleNumber, c.Status.ToString(), c.SelectionResultId ?? Guid.Empty, c.SelectionMethod.ToString(), recipients);
    }
    public async Task CompleteAndOpenNextAsync(Guid cycleId, Guid actor, DbTransaction tx, DateTimeOffset now, CancellationToken ct)
    {
        var source = await ReadLockedAsync(cycleId, tx, ct);
        if (source.Status == "Completed") return;
        BusinessRuleException.Require(source.Active, "PAYOUT_GROUP_SUSPENDED", "Group must be active to complete a cycle.");
        await using var db = Context(tx); await db.Database.UseTransactionAsync(tx, ct);
        var group = await db.Groups.SingleAsync(g => g.Id == source.GroupId, ct);
        var cycles = await db.MonthlyCycles.Where(c => c.GroupId == group.Id).OrderBy(c => c.CycleNumber).ToArrayAsync(ct);
        var current = cycles.Single(c => c.Id == cycleId);
        BusinessRuleException.Require(group.CurrentCycleNumber == current.CycleNumber && cycles.Length == group.DurationMonths, "NEXT_CYCLE_NOT_ALLOWED", "Cycle schedule is inconsistent.");
        current.CompleteSettlement(now);
        void Audit(string action, Guid? cycle = null) => db.AuditEvents.Add(new(group.Id, actor, action, now, cycleId: cycle ?? cycleId));
        Audit("CYCLE_PAYOUTS_COMPLETED"); Audit("CYCLE_COMPLETED");
        var next = cycles.SingleOrDefault(c => c.CycleNumber == current.CycleNumber + 1);
        if (next is not null)
        {
            BusinessRuleException.Require(!cycles.Any(c => c.Status == CycleStatus.CollectingContributions), "NEXT_CYCLE_NOT_ALLOWED", "Another cycle is already collecting.");
            next.OpenNext(now); group.AdvanceCycle(next.CycleNumber, now); Audit("NEXT_CYCLE_OPENED", next.Id);
        }
        else
        {
            var members = await db.Memberships.Where(m => m.GroupId == group.Id && m.SlotNumber != null).ToArrayAsync(ct);
            var selections = await db.SelectionResults.Where(s => s.GroupId == group.Id).ToArrayAsync(ct);
            BusinessRuleException.Require(cycles.All(c => c.Status == CycleStatus.Completed) && members.Length == group.MemberLimit && selections.Length == members.Length &&
                members.All(m => m.HasBeenSelectedForPayout && selections.Count(s => s.WinnerMembershipId == m.Id) == 1),
                "CYCLE_SETTLEMENT_INCOMPLETE", "All cycles must be completed and every participating member selected exactly once.");
            group.Complete(now); Audit("GROUP_COMPLETED");
        }
        await db.SaveChangesAsync(ct);
    }
}
