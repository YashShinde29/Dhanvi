using System.Data.Common;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;
internal sealed class ContributionSettlementService(IGroupUserDirectory users) : IContributionSettlementService
{
    private static GroupsDbContext Context(DbTransaction tx) => new(new DbContextOptionsBuilder<GroupsDbContext>().UseNpgsql(tx.Connection!).Options);
    public async Task<ContributionPaymentSource> ReadLockedAsync(Guid id, DbTransaction tx, CancellationToken ct)
    {
        await using var db = Context(tx); await db.Database.UseTransactionAsync(tx, ct);
        var groupId = await db.Contributions.Where(c => c.Id == id).Select(c => (Guid?)c.GroupId).SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Contribution not found.");
        var group = await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {groupId} FOR UPDATE").SingleAsync(ct);
        var contribution = await db.Contributions.SingleAsync(c => c.Id == id, ct);
        var cycle = await db.MonthlyCycles.SingleAsync(c => c.Id == contribution.CycleId, ct);
        var member = await db.Memberships.SingleAsync(m => m.Id == contribution.MembershipId, ct);
        var user = await users.FindAsync(member.UserId, ct);
        var allowed = group.Rules.CollectionMode == ContributionCollectionMode.Razorpay && group.CreatorType == GroupCreatorType.Platform &&
            group.Status == GroupStatus.Active && cycle.Status == CycleStatus.CollectingContributions && cycle.CycleNumber == group.CurrentCycleNumber &&
            member.Status == MembershipStatus.Active && user is not null && contribution.FinanciallySettledAmount < contribution.ExpectedAmount;
        return new(id, groupId, cycle.Id, member.Id, member.UserId, group.Name, user?.Name ?? "Member", cycle.CycleNumber,
            group.GroupTimeZone, contribution.ExpectedAmount, contribution.FinanciallySettledAmount, contribution.FinancialStatus.ToString(),
            group.Rules.CollectionMode.ToString(), allowed, cycle.SelectionResultId.HasValue || cycle.Status is not (CycleStatus.CollectingContributions or CycleStatus.ReadyForSelection or CycleStatus.ContributionsComplete));
    }
    public Task SettleAsync(Guid id, Guid payment, decimal amount, DbTransaction tx, DateTimeOffset now, CancellationToken ct) => Apply(id, payment, amount, false, tx, now, ct);
    public Task ReverseAsync(Guid id, Guid payment, DbTransaction tx, DateTimeOffset now, CancellationToken ct) => Apply(id, payment, 0, true, tx, now, ct);
    private async Task Apply(Guid id, Guid payment, decimal amount, bool reverse, DbTransaction tx, DateTimeOffset now, CancellationToken ct)
    {
        var source = await ReadLockedAsync(id, tx, ct);
        BusinessRuleException.Require(source.CollectionMode == "Razorpay" && !source.SelectionCompleted, "SETTLEMENT_REVIEW_REQUIRED", "Settlement correction requires an unselected Razorpay cycle.");
        await using var db = Context(tx); await db.Database.UseTransactionAsync(tx, ct);
        var c = await db.Contributions.SingleAsync(c => c.Id == id, ct);
        if (reverse) c.Refund(payment, now); else c.Settle(payment, amount, now);
        var all = await db.Contributions.Where(x => x.CycleId == c.CycleId).ToListAsync(ct);
        var cycle = await db.MonthlyCycles.SingleAsync(x => x.Id == c.CycleId, ct);
        var ready = cycle.RecalculateFinancial(all.Sum(x => x.FinanciallySettledAmount), all.Count(x => x.FinanciallySettledAmount == x.ExpectedAmount), all.Count, now);
        db.AuditEvents.Add(new(c.GroupId, source.UserId, reverse ? "CONTRIBUTION_SETTLEMENT_REVERSED" : "CONTRIBUTION_FINANCIALLY_SETTLED", now, id));
        if (ready || reverse) db.AuditEvents.Add(new(c.GroupId, source.UserId, ready ? "CYCLE_READY_FOR_SELECTION" : "CYCLE_FINANCIAL_SHORTFALL_REOPENED", now, c.CycleId));
        await db.SaveChangesAsync(ct);
    }
}
