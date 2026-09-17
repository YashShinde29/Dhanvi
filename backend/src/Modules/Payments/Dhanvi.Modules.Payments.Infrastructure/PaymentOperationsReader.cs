using System.Text.Json;
using Dhanvi.Modules.Admin.Application;
using Dhanvi.Modules.Payments.Domain;
using Dhanvi.Modules.Payments.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Payments.Infrastructure;

/// <summary>Admin read model over incoming payments: per-group exception counts and platform-wide reconciliation state.</summary>
internal sealed class PaymentOperationsReader(PaymentsDbContext db) : IPaymentOperationsReader
{
    private static string Name<T>(T value) where T : struct, Enum => JsonNamingPolicy.SnakeCaseUpper.ConvertName(value.ToString());
    private static AdminPaymentCounts Counts(IEnumerable<(PaymentStatus Status, int Count)> rows)
    {
        int Of(params PaymentStatus[] statuses) => rows.Where(r => statuses.Contains(r.Status)).Sum(r => r.Count);
        return new(Of(PaymentStatus.Captured), Of(PaymentStatus.Created, PaymentStatus.Pending, PaymentStatus.Authorized), Of(PaymentStatus.Failed),
            Of(PaymentStatus.ReconciliationRequired), Of(PaymentStatus.Refunded, PaymentStatus.RefundPending));
    }
    public async Task<IReadOnlyDictionary<Guid, AdminPaymentCounts>> CountsByGroupAsync(IReadOnlyCollection<Guid> groupIds, CancellationToken ct)
    {
        if (groupIds.Count == 0) return new Dictionary<Guid, AdminPaymentCounts>();
        var rows = await db.Payments.AsNoTracking().Where(p => groupIds.Contains(p.GroupId)).GroupBy(p => new { p.GroupId, p.Status })
            .Select(x => new { x.Key.GroupId, x.Key.Status, Count = x.Count() }).ToListAsync(ct);
        return rows.GroupBy(r => r.GroupId).ToDictionary(g => g.Key, g => Counts(g.Select(r => (r.Status, r.Count))));
    }
    public async Task<IReadOnlyList<AdminPaymentSnapshot>> IssuesAsync(Guid groupId, CancellationToken ct)
    {
        var rows = await db.Payments.AsNoTracking().Where(p => p.GroupId == groupId && (p.Status == PaymentStatus.ReconciliationRequired || p.Status == PaymentStatus.Failed || p.ReconciliationStatus == ReconciliationStatus.Mismatch || p.ReconciliationStatus == ReconciliationStatus.Failed))
            .OrderByDescending(p => p.CreatedAt).Take(50).ToListAsync(ct);
        return rows.Select(p => new AdminPaymentSnapshot(p.Id, p.CycleId, p.CycleNumber, p.MemberName, p.Amount, Name(p.Status), Name(p.ReconciliationStatus), p.ReconciliationMessage, p.CreatedAt)).ToArray();
    }
    public async Task<AdminPaymentOverview> OverviewAsync(CancellationToken ct)
    {
        var rows = await db.Payments.AsNoTracking().GroupBy(p => p.Status).Select(x => new { Status = x.Key, Count = x.Count() }).ToListAsync(ct);
        var counts = Counts(rows.Select(r => (r.Status, r.Count)));
        var reconciliation = db.Payments.AsNoTracking().Where(p => p.Status == PaymentStatus.ReconciliationRequired);
        var pending = db.Payments.AsNoTracking().Where(p => p.Status == PaymentStatus.Pending || p.Status == PaymentStatus.Authorized || p.Status == PaymentStatus.Created);
        return new(counts,
            counts.ReconciliationRequired == 0 ? AdminAttentionBucket.Empty : new(counts.ReconciliationRequired, await reconciliation.MinAsync(p => p.UpdatedAt, ct)),
            counts.Pending == 0 ? AdminAttentionBucket.Empty : new(counts.Pending, await pending.MinAsync(p => p.CreatedAt, ct)));
    }
}
