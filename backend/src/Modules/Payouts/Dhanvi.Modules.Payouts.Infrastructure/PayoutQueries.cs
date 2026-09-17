using System.Data.Common;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Payouts.Infrastructure;
internal sealed partial class PayoutService
{
    private static BeneficiaryView View(PayoutBeneficiary b) => new(b.Id, b.MaskedAccountNumber, b.AccountHolderName, b.BankName, b.Ifsc, b.Status, b.CreatedAt, b.AvailableAt);
    private static PayoutView View(PayoutObligation p, string? masked, bool beneficiaryAvailable) => new(p.Id, p.GroupId, p.GroupName, p.CycleId, p.CycleNumber, p.MemberName, p.PayoutType, p.Amount,
        p.Currency, p.Status, masked, p.SelectionResultId, p.AuctionResultId, p.AllocationJournalId, p.SettlementJournalId, p.CreatedAt, p.ApprovedAt, p.SettledAt, beneficiaryAvailable);
    private async Task<PayoutView> View(PayoutObligation p, CancellationToken ct)
    {
        var masked = p.BeneficiaryId is null ? null : await db.Beneficiaries.Where(b => b.Id == p.BeneficiaryId).Select(b => b.MaskedAccountNumber).SingleAsync(ct);
        var available = p.BeneficiaryId.HasValue || !p.UserId.HasValue || await BeneficiaryAvailableAsync(p.UserId.Value, ct);
        return View(p, masked, available);
    }
    // Same lookup the approval uses (latest account, past its hold); presented so operators know whether Approve can succeed.
    private async Task<bool> BeneficiaryAvailableAsync(Guid user, CancellationToken ct)
    {
        var now = clock.UtcNow;
        return await db.Beneficiaries.AsNoTracking().Where(b => b.UserId == user).OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id).Select(b => b.AvailableAt <= now).FirstOrDefaultAsync(ct);
    }
    private async Task<IReadOnlyList<PayoutView>> Views(IEnumerable<PayoutObligation> rows, CancellationToken ct)
    { var result = new List<PayoutView>(); foreach (var p in rows) result.Add(await View(p, ct)); return result; }
    public async Task<PayoutPage> ListAsync(Guid actor, bool admin, Guid? group, int page, PayoutStatus? status, PayoutType? type, CancellationToken ct, PayoutFilter? filter = null)
    {
        page = Math.Max(1, page); var q = db.Obligations.AsNoTracking();
        if (group.HasValue)
        {
            if (!admin && !await cycles.CanInspectAsync(group.Value, actor, ct)) throw new ForbiddenException("Only the group's organizer may inspect group payouts.");
            q = q.Where(p => p.GroupId == group);
        }
        else if (!admin) q = q.Where(p => p.UserId == actor);
        if (filter?.CycleId is { } cycle) q = q.Where(p => p.CycleId == cycle);
        if (filter?.From is { } from) q = q.Where(p => p.CreatedAt >= from);
        if (filter?.To is { } to) q = q.Where(p => p.CreatedAt < to);
        var summary = await q.GroupBy(p => p.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToArrayAsync(ct);
        if (status.HasValue) q = q.Where(p => p.Status == status); if (type.HasValue) q = q.Where(p => p.PayoutType == type);
        var count = await q.CountAsync(ct); var rows = await q.OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id).Skip((page - 1) * 20).Take(20).ToArrayAsync(ct);
        return new(await Views(rows, ct), count, page, 20, summary.ToDictionary(x => System.Text.Json.JsonNamingPolicy.SnakeCaseUpper.ConvertName(x.Status.ToString()), x => x.Count));
    }
    public async Task<PayoutDetails> DetailsAsync(Guid id, Guid actor, bool admin, CancellationToken ct)
    {
        var p = await db.Obligations.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct) ?? throw new NotFoundException("Payout not found.");
        if (!admin && p.UserId != actor) throw new ForbiddenException("This payout belongs to another member.");
        var attempts = await db.Attempts.AsNoTracking().Where(a => a.PayoutObligationId == id).OrderBy(a => a.AttemptNumber).ToArrayAsync(ct);
        var events = await db.Events.AsNoTracking().Where(e => e.PayoutObligationId == id).OrderBy(e => e.ReceivedAt).ThenBy(e => e.Id).ToArrayAsync(ct);
        var views = attempts.Select(a => {
            var observations = events.Where(e => e.PayoutAttemptId == a.Id).ToArray();
            var failed = observations.Any(e => e.Matched && e.Status == GatewayPayoutStatus.Failed);
            var success = observations.Any(e => e.Matched && e.Status == GatewayPayoutStatus.Success);
            var mismatch = observations.Any(e => !e.Matched);
            return new AttemptView(a.Id, a.AttemptNumber, a.Provider, a.ProviderPayoutId, a.Amount, a.MaskedAccountNumber, a.RequestedAt,
                mismatch ? "RECONCILIATION_REQUIRED" : success ? "SUCCEEDED" : failed ? "FAILED" : observations.Length > 0 ? "PROVIDER_PENDING" : "PROCESSING",
                observations.FirstOrDefault(e => e.Matched && e.Status is GatewayPayoutStatus.Success or GatewayPayoutStatus.Failed)?.ReceivedAt,
                failed ? "PAYOUT_PROVIDER_FAILED" : null);
        }).ToArray();
        var history = await db.History.AsNoTracking().Where(h => h.PayoutObligationId == id).OrderBy(h => h.CreatedAt).Select(h => new PayoutHistoryView(h.Id, h.Action, h.Message, h.CreatedAt)).ToArrayAsync(ct);
        return new(await View(p, ct), views, history, admin ? events.Select(e => new PayoutEventView(e.Id, e.ProviderEventId, e.Status, e.Matched, e.ReceivedAt)).ToArray() : []);
    }
}
internal sealed class PayoutLedgerReader : IPayoutLedgerReader
{
    public async Task<SettledPayoutSource> ReadAsync(Guid id, DbTransaction transaction, CancellationToken ct)
    {
        await using var db = new PayoutsDbContext(new DbContextOptionsBuilder<PayoutsDbContext>().UseNpgsql(transaction.Connection!).Options);
        await db.Database.UseTransactionAsync(transaction, ct);
        var p = await db.Obligations.SingleAsync(p => p.Id == id, ct);
        BusinessRuleException.Require(p.MembershipId.HasValue && p.UserId.HasValue && p.PayoutType != PayoutType.PlatformFeeSettlement,
            "INVALID_PAYOUT_SOURCE", "External settlement requires a member payout.");
        var attempt = await db.Attempts.Where(a => a.PayoutObligationId == id).OrderByDescending(a => a.AttemptNumber).FirstOrDefaultAsync(ct);
        var success = attempt is not null && await db.Events.AnyAsync(e => e.PayoutAttemptId == attempt.Id && e.Matched && e.Status == GatewayPayoutStatus.Success, ct) &&
            !await db.Events.AnyAsync(e => e.PayoutAttemptId == attempt.Id && (!e.Matched || e.Status == GatewayPayoutStatus.Failed), ct);
        return new(p.Id, p.GroupId, p.CycleId, p.MembershipId!.Value, p.SelectionResultId, p.AuctionResultId, p.Amount,
            p.PayoutType == PayoutType.MemberAuctionBenefit, p.TimeZone, attempt?.CreatedByUserId ?? p.ApprovedByUserId ?? p.UserId!.Value,
            attempt?.RequestedAt ?? p.CreatedAt, success, p.AllocationJournalId);
    }
}
