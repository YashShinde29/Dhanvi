using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.RandomDraws.Application;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

// Persistence adapter only. Algorithm, eligibility policy, verification and command logic live in RandomDraws.
internal sealed class SelectionStore(GroupsDbContext db, IGroupUserDirectory users, IOrganizerStatusReader organizers, ILedgerPostingService ledger) : ISelectionStore
{
    public Task<SelectionContext> ReadAsync(Guid groupId, Guid cycleId, Guid actorId, CancellationToken ct) => Load(groupId, cycleId, actorId, false, ct);
    public async Task<SelectionContext> ExecuteLockedAsync(Guid groupId, Guid cycleId, Guid actorId, Func<SelectionContext, SelectionMutation> execute, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var context = await Load(groupId, cycleId, actorId, true, ct);
        var mutation = execute(context);
        if (mutation.Created) { db.SelectionResults.Add(mutation.Result); db.AuditEvents.AddRange(mutation.AuditEvents); await db.SaveChangesAsync(ct); }
        if (mutation.Created) await ledger.PostAsync(mutation.Result.SelectionMethod == SelectionMethod.Random ? AccountingEventType.RandomSelectionCompleted : AccountingEventType.OrganizerReservedSelectionCompleted,
            mutation.Result.Id, actorId, null, tx.GetDbTransaction(), ct);
        await tx.CommitAsync(ct); return context with { ExistingResult = mutation.Result };
    }
    public async Task AddVerificationAuditAsync(GroupAuditEvent auditEvent, CancellationToken ct)
    {
        db.AuditEvents.Add(auditEvent); await db.SaveChangesAsync(ct);
    }
    private async Task<SelectionContext> Load(Guid groupId, Guid cycleId, Guid actorId, bool locked, CancellationToken ct)
    {
        var groupQuery = locked ? db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {groupId} FOR UPDATE") : db.Groups.Where(g => g.Id == groupId);
        var group = await groupQuery.SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Group not found.");
        var cycle = await db.MonthlyCycles.SingleOrDefaultAsync(c => c.GroupId == groupId && c.Id == cycleId, ct) ?? throw new NotFoundException("Cycle not found in this group.");
        var members = await db.Memberships.Where(m => m.GroupId == groupId).ToListAsync(ct);
        var participants = new List<SelectionParticipant>(members.Count);
        foreach (var member in members)
        {
            var user = await users.FindAsync(member.UserId, ct);
            var names = user?.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var display = names is { Length: > 0 } ? names[0] + (names.Length > 1 ? $" {names[^1][0]}." : "") : "Unavailable member";
            participants.Add(new(member, user is not null, display));
        }
        var contributions = await db.Contributions.Where(c => c.GroupId == groupId && c.CycleId == cycleId).ToListAsync(ct);
        var result = await db.SelectionResults.Include(r => r.EligibleMembers).SingleOrDefaultAsync(r => r.CycleId == cycleId && r.GroupId == groupId, ct);
        return new(group, cycle, participants, contributions, group.CreatorType == GroupCreatorType.Platform || await organizers.GetStatusAsync(group.CreatedByUserId, ct) == "APPROVED", await users.FindAsync(actorId, ct) is not null, result);
    }
}
