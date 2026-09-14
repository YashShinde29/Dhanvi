using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Domain;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Payments.Infrastructure;
internal sealed partial class PaymentService
{
    public async Task<PaymentDetails> DetailsAsync(Guid id, Guid actor, bool admin, CancellationToken ct)
    {
        var p = await Find(id, actor, admin, ct);
        return new(View(p), await db.History.AsNoTracking().Where(h => h.PaymentId == id).OrderBy(h => h.CreatedAt).ToArrayAsync(ct),
            admin ? await db.Events.AsNoTracking().Where(e => e.PaymentId == id).OrderBy(e => e.ReceivedAt).ToArrayAsync(ct) : [],
            await db.Refunds.AsNoTracking().Where(r => r.PaymentId == id).OrderBy(r => r.CreatedAt).ToArrayAsync(ct));
    }
    public async Task<PaymentPage> ListAsync(Guid actor, bool admin, int page, int pageSize, PaymentStatus? status, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 100000); pageSize = Math.Clamp(pageSize, 1, 100);
        var q = db.Payments.AsNoTracking().Where(p => admin || p.UserId == actor);
        var totals = await q.GroupBy(p => p.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToArrayAsync(ct);
        if (status.HasValue) q = q.Where(p => p.Status == status);
        var count = await q.CountAsync(ct); var items = await q.OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id).Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(ct);
        int Count(PaymentStatus value) => totals.Where(t => t.Status == value).Sum(t => t.Count);
        return new(items.Select(View).ToArray(), count, page, pageSize, Count(PaymentStatus.Captured),
            Count(PaymentStatus.Created) + Count(PaymentStatus.Pending) + Count(PaymentStatus.Authorized), Count(PaymentStatus.Failed), Count(PaymentStatus.ReconciliationRequired));
    }
}
