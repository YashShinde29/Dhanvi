using System.Text.Json;
using Dhanvi.Modules.Admin.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Payouts.Infrastructure;

/// <summary>Admin read model over payout obligations: per-group stage counts, a group's payouts, and platform-wide attention buckets.</summary>
internal sealed class PayoutOperationsReader(PayoutsDbContext db, Dhanvi.SharedKernel.Time.IDateTimeProvider clock) : IPayoutOperationsReader
{
    // Unapproved payouts whose recipient's latest account is usable now count as "awaiting approval"; the rest wait on the member.
    private IQueryable<PayoutObligation> Unapproved => db.Obligations.AsNoTracking().Where(p => p.Status == PayoutStatus.PendingBeneficiary || p.Status == PayoutStatus.ApprovalRequired);
    private IQueryable<PayoutObligation> Approvable(DateTimeOffset now) => Unapproved.Where(p => p.UserId != null &&
        db.Beneficiaries.Where(b => b.UserId == p.UserId).OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id).Select(b => b.AvailableAt <= now).FirstOrDefault());
    private static string Name<T>(T value) where T : struct, Enum => JsonNamingPolicy.SnakeCaseUpper.ConvertName(value.ToString());
    private static AdminPayoutCounts Counts(IEnumerable<(PayoutStatus Status, int Count)> rows)
    {
        int Of(params PayoutStatus[] statuses) => rows.Where(r => statuses.Contains(r.Status)).Sum(r => r.Count);
        return new(Of(PayoutStatus.PendingBeneficiary), Of(PayoutStatus.ApprovalRequired), Of(PayoutStatus.Approved), Of(PayoutStatus.Processing, PayoutStatus.ProviderPending),
            Of(PayoutStatus.Succeeded), Of(PayoutStatus.Failed), Of(PayoutStatus.ReconciliationRequired), Of(PayoutStatus.Cancelled));
    }
    public async Task<IReadOnlyDictionary<Guid, AdminPayoutCounts>> CountsByGroupAsync(IReadOnlyCollection<Guid> groupIds, CancellationToken ct)
    {
        if (groupIds.Count == 0) return new Dictionary<Guid, AdminPayoutCounts>();
        var rows = await db.Obligations.AsNoTracking().Where(p => groupIds.Contains(p.GroupId)).GroupBy(p => new { p.GroupId, p.Status })
            .Select(x => new { x.Key.GroupId, x.Key.Status, Count = x.Count() }).ToListAsync(ct);
        var approvable = await Approvable(clock.UtcNow).Where(p => groupIds.Contains(p.GroupId)).GroupBy(p => p.GroupId).Select(x => new { GroupId = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.GroupId, x => x.Count, ct);
        return rows.GroupBy(r => r.GroupId).ToDictionary(g => g.Key, g =>
        {
            var c = Counts(g.Select(r => (r.Status, r.Count))); var ready = approvable.GetValueOrDefault(g.Key);
            return c with { ApprovalRequired = ready, PendingBeneficiary = Math.Max(0, c.PendingBeneficiary + c.ApprovalRequired - ready) };
        });
    }
    public async Task<IReadOnlyList<AdminPayoutSnapshot>> GroupPayoutsAsync(Guid groupId, CancellationToken ct)
    {
        var rows = await db.Obligations.AsNoTracking().Where(p => p.GroupId == groupId).OrderByDescending(p => p.CycleNumber).ThenBy(p => p.PayoutType).ThenBy(p => p.CreatedAt).Take(200).ToListAsync(ct);
        var approvable = (await Approvable(clock.UtcNow).Where(p => p.GroupId == groupId).Select(p => p.Id).ToListAsync(ct)).ToHashSet();
        return rows.Select(p => new AdminPayoutSnapshot(p.Id, p.CycleId, p.CycleNumber, Name(p.PayoutType), p.MembershipId, p.MemberName, p.Amount,
            p.Status == PayoutStatus.PendingBeneficiary && approvable.Contains(p.Id) ? Name(PayoutStatus.ApprovalRequired) : Name(p.Status),
            p.BeneficiaryId.HasValue || p.PayoutType == PayoutType.PlatformFeeSettlement || approvable.Contains(p.Id), p.CreatedAt, p.ApprovedAt, p.SettledAt)).ToArray();
    }
    public async Task<IReadOnlyList<AdminActivityEntry>> ActivityAsync(Guid groupId, int limit, CancellationToken ct)
    {
        var rows = await db.History.AsNoTracking().Where(h => db.Obligations.Any(p => p.Id == h.PayoutObligationId && p.GroupId == groupId))
            .OrderByDescending(h => h.CreatedAt).Take(Math.Clamp(limit, 1, 200))
            .Select(h => new { h.Id, h.CreatedAt, h.Action, h.Message, h.PayoutObligationId, CycleId = db.Obligations.Where(p => p.Id == h.PayoutObligationId).Select(p => (Guid?)p.CycleId).FirstOrDefault() }).ToListAsync(ct);
        return rows.Select(h => new AdminActivityEntry(h.Id, h.CreatedAt, "PAYOUT", h.Action, null, h.Message, h.PayoutObligationId, h.CycleId)).ToArray();
    }
    public async Task<AdminPayoutOverview> OverviewAsync(CancellationToken ct)
    {
        var rows = await db.Obligations.AsNoTracking().GroupBy(p => p.Status).Select(x => new { Status = x.Key, Count = x.Count() }).ToListAsync(ct);
        var raw = Counts(rows.Select(r => (r.Status, r.Count)));
        var now = clock.UtcNow;
        var approvable = await Approvable(now).CountAsync(ct);
        var counts = raw with { ApprovalRequired = approvable, PendingBeneficiary = Math.Max(0, raw.PendingBeneficiary + raw.ApprovalRequired - approvable) };
        async Task<AdminAttentionBucket> Bucket(int count, IQueryable<PayoutObligation> source) => count == 0 ? AdminAttentionBucket.Empty : new(count, await source.MinAsync(p => p.UpdatedAt, ct));
        IQueryable<PayoutObligation> Of(params PayoutStatus[] statuses) => db.Obligations.AsNoTracking().Where(p => statuses.Contains(p.Status));
        var approvableIds = Approvable(now).Select(p => p.Id);
        return new(counts, await Bucket(counts.ApprovalRequired, Approvable(now)), await Bucket(counts.Approved, Of(PayoutStatus.Approved)), await Bucket(counts.Failed, Of(PayoutStatus.Failed)),
            await Bucket(counts.ReconciliationRequired, Of(PayoutStatus.ReconciliationRequired)), await Bucket(counts.PendingBeneficiary, Unapproved.Where(p => !approvableIds.Contains(p.Id))),
            await Bucket(counts.Processing, Of(PayoutStatus.Processing, PayoutStatus.ProviderPending)));
    }
}
