using System.Data.Common;
using System.Security.Cryptography;
using System.Text.Json;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
namespace Dhanvi.Modules.Payouts.Infrastructure;
internal sealed partial class PayoutService(PayoutsDbContext db, ICycleSettlementStore cycles, ILedgerSourceReader sources,
    ILedgerPostingService ledger, IPayoutGateway gateway, IPayoutApprovalPolicy approval, IDateTimeProvider clock) : IPayoutService
{
    private static void Active(SettlementCycle c) => BusinessRuleException.Require(c.Active, "PAYOUT_GROUP_SUSPENDED", "Payout execution requires an active group.");
    public async Task<BeneficiaryView?> AccountAsync(Guid user, CancellationToken ct)
    { var b = await LatestBeneficiary(user, ct); return b is null ? null : View(b); }
    private Task<PayoutBeneficiary?> LatestBeneficiary(Guid user, CancellationToken ct) => db.Beneficiaries.AsNoTracking().Where(b => b.UserId == user).OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id).FirstOrDefaultAsync(ct);
    public async Task<BeneficiaryView> AddAccountAsync(Guid user, PayoutAccountRequest r, CancellationToken ct)
    {
        PayoutBeneficiary.Validate(r.AccountHolderName, r.AccountNumber, r.ConfirmAccountNumber, r.Ifsc, r.BankName);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({user.ToString()}, 92))", ct);
        var previous = await LatestBeneficiary(user, ct);
        var now = clock.UtcNow;
        if (previous is not null && now <= previous.CreatedAt) now = previous.CreatedAt.AddTicks(10);
        var token = await gateway.CreateFundAccountAsync(Guid.NewGuid(), ct);
        var b = PayoutBeneficiary.Create(user, token, r.AccountHolderName, r.AccountNumber[^4..], r.Ifsc, r.BankName ?? "", now, previous is not null);
        db.Beneficiaries.Add(b); await db.SaveChangesAsync(ct);
        await Audit(b.Id, user, previous is null ? "PAYOUT_BENEFICIARY_ADDED" : "PAYOUT_BENEFICIARY_CHANGED", tx.GetDbTransaction(), ct);
        await tx.CommitAsync(ct); return View(b);
    }
    private static AccountingEventType Event(SettlementCycle c) => c.SelectionMethod switch {
        "Random" => AccountingEventType.RandomSelectionCompleted, "OrganizerReserved" => AccountingEventType.OrganizerReservedSelectionCompleted,
        "Auction" => AccountingEventType.AuctionSelectionCompleted, _ => throw new BusinessRuleException("INVALID_PAYOUT_SOURCE", "Unsupported selection method.") };
    public async Task<IReadOnlyList<PayoutView>> PrepareCycleSettlementAsync(Guid cycle, Guid actor, bool admin, CancellationToken ct)
    {
        approval.EnsureOperator(admin, actor, null);
        await using var tx = await db.Database.BeginTransactionAsync(ct); var raw = tx.GetDbTransaction();
        var c = await cycles.ReadLockedAsync(cycle, raw, ct);
        var existing = await db.Obligations.Where(p => p.CycleId == cycle).ToArrayAsync(ct);
        if (existing.Length > 0) { await tx.CommitAsync(ct); return await Views(existing, ct); }
        Active(c);
        BusinessRuleException.Require(c.Status == "SelectionCompleted" && c.SelectionResultId != Guid.Empty, "INVALID_PAYOUT_SOURCE", "A finalized selection is required.");
        var s = await sources.ReadLockedAsync(Event(c), c.SelectionResultId, raw, ct);
        var posted = await ledger.PostAsync(Event(c), c.SelectionResultId, actor, null, raw, ct);
        BusinessRuleException.Require(posted.Status == "POSTED" && posted.JournalId.HasValue, "INSUFFICIENT_FUNDED_POOL", "Ledger must contain the full funded pool before preparing payouts.");
        PayoutObligation Create(PayoutType type, Guid? member, decimal amount)
        {
            var recipient = member.HasValue ? c.Recipients.SingleOrDefault(r => r.MembershipId == member) : null;
            BusinessRuleException.Require(!member.HasValue || recipient is not null, "INVALID_PAYOUT_SOURCE", "Source recipient must belong to the cycle.");
            return PayoutObligation.Create(c.GroupId, c.GroupName, cycle, c.CycleNumber, member, recipient?.UserId, recipient?.Name ?? "Platform fee (internal)",
                s.SelectionResultId!.Value, s.AuctionResultId, member ?? s.SelectionResultId.Value, type, amount, s.TimeZone, posted.JournalId!.Value, clock.UtcNow);
        }
        var rows = new List<PayoutObligation> { Create(PayoutType.WinnerPayout, s.WinnerMembershipId, s.WinnerPayout) };
        rows.AddRange(s.Benefits.Select(b => Create(PayoutType.MemberAuctionBenefit, b.MembershipId, b.Amount)));
        if (s.PlatformFee > 0) { var fee = Create(PayoutType.PlatformFeeSettlement, null, s.PlatformFee); fee.SettleInternalFee(clock.UtcNow); rows.Add(fee); }
        db.Obligations.AddRange(rows); await db.SaveChangesAsync(ct);
        foreach (var p in rows.Where(p => p.PayoutType != PayoutType.PlatformFeeSettlement)) await ledger.EnsurePayoutFundedAsync(p.Id, raw, ct);
        foreach (var p in rows)
        {
            await History(p, actor, "PAYOUT_OBLIGATIONS_CREATED", "Immutable selection allocations backed by the funded Ledger journal.", raw, ct);
            if (p.PayoutType == PayoutType.PlatformFeeSettlement)
                await History(p, actor, "PLATFORM_FEE_SETTLED", "Internal allocation completed under the source journal fee policy; no external transfer or additional revenue recognition.", raw, ct);
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await Views(rows, ct);
    }
    public Task<PayoutView> ApproveAsync(Guid id, Guid actor, bool admin, CancellationToken ct) => WithPayout(id, async (p, c, tx) => {
        approval.EnsureOperator(admin, actor, p.UserId); Active(c);
        if (p.Status == PayoutStatus.Approved) return await View(p, ct);
        BusinessRuleException.Require(p.UserId.HasValue, "PAYOUT_NOT_READY", "Internal fees do not require a beneficiary.");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.UserId.ToString()}, 92))", ct);
        var b = await LatestBeneficiary(p.UserId!.Value, ct) ?? throw new BusinessRuleException("PAYOUT_BENEFICIARY_REQUIRED", "The recipient must add a payout account.");
        p.Approve(b, actor, clock.UtcNow); await History(p, actor, "PAYOUT_APPROVED", "Admin approval locked the beneficiary version.", tx, ct); return await View(p, ct);
    }, ct);
    public async Task<PayoutView> ExecuteAsync(Guid id, Guid actor, bool admin, string key, bool retry, CancellationToken ct)
    {
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(key) && key.Length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send a stable Idempotency-Key of at most 200 characters.");
        PayoutAttempt? intent = null;
        var reserved = await WithPayout(id, async (p, c, tx) => {
            approval.EnsureOperator(admin, actor, p.UserId); Active(c);
            if (await db.Attempts.AnyAsync(a => a.PayoutObligationId == id && a.RequestKey == key, ct) || p.Status is PayoutStatus.Succeeded or PayoutStatus.Processing or PayoutStatus.ProviderPending)
                return await View(p, ct);
            await ledger.EnsurePayoutFundedAsync(p.Id, tx, ct);
            p.Begin(retry, clock.UtcNow);
            await db.SaveChangesAsync(ct);
            var b = await db.Beneficiaries.SingleAsync(b => b.Id == p.BeneficiaryId, ct);
            intent = PayoutAttempt.Create(p, b, await db.Attempts.CountAsync(a => a.PayoutObligationId == id, ct) + 1, key, actor, clock.UtcNow);
            db.Attempts.Add(intent);
            await History(p, actor, retry ? "PAYOUT_RETRY_CREATED" : "PAYOUT_EXECUTION_REQUESTED", "Durable immutable intent reserved before provider call.", tx, ct);
            return await View(p, ct);
        }, ct);
        if (intent is null) return reserved;
        try { await gateway.InitiatePayoutAsync(Request(intent), ct); }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
        { return reserved; } // durable Processing intent; reconcile the SAME provider key after an uncertain result
        return await ReconcileAsync(id, actor, admin, ct);
    }
    private static GatewayPayoutRequest Request(PayoutAttempt a) => new(a.ProviderPayoutId, a.IdempotencyKey, a.ProviderFundAccountId, a.Amount, a.Currency, a.PayoutObligationId.ToString("N"));
    public async Task<PayoutView> ReconcileAsync(Guid id, Guid actor, bool admin, CancellationToken ct)
    {
        approval.EnsureOperator(admin, actor, null);
        var initial = await db.Obligations.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct) ?? throw new NotFoundException("Payout not found.");
        var attempt = await db.Attempts.AsNoTracking().Where(a => a.PayoutObligationId == id).OrderByDescending(a => a.AttemptNumber).FirstOrDefaultAsync(ct);
        if (attempt is null || initial.Status is PayoutStatus.Succeeded or PayoutStatus.ReconciliationRequired) return await View(initial, ct);
        var remote = await gateway.GetPayoutStatusAsync(attempt.ProviderPayoutId, ct);
        if (remote is null)
        {
            // Re-submit only the durable SAME intent/key, after rechecking group and liability under lock.
            await WithPayout(id, async (p, c, tx) => {
                if (p.Status is PayoutStatus.Succeeded or PayoutStatus.ReconciliationRequired) return false;
                var currentAttempt = await db.Attempts.Where(a => a.PayoutObligationId == id).OrderByDescending(a => a.AttemptNumber).FirstAsync(ct);
                if (currentAttempt.Id != attempt.Id) return false;
                Active(c); approval.EnsureOperator(admin, actor, p.UserId);
                BusinessRuleException.Require(p.Status == PayoutStatus.Processing, "PAYOUT_RECONCILIATION_REQUIRED", "Missing provider transfer requires review.");
                await ledger.EnsurePayoutFundedAsync(id, tx, ct); await gateway.InitiatePayoutAsync(Request(attempt), ct); return true; }, ct);
            remote = await gateway.GetPayoutStatusAsync(attempt.ProviderPayoutId, ct);
        }
        return await WithPayout(id, async (p, c, tx) => {
            if (p.Status is PayoutStatus.Succeeded or PayoutStatus.ReconciliationRequired) return await View(p, ct);
            var latest = await db.Attempts.Where(a => a.PayoutObligationId == id).OrderByDescending(a => a.AttemptNumber).FirstAsync(ct);
            if (latest.Id != attempt.Id) return await View(p, ct); // observation of an earlier failed attempt cannot alter its retry
            var matched = remote is not null && remote.Id == attempt.ProviderPayoutId && remote.Amount == p.Amount && remote.Currency == p.Currency &&
                remote.FundAccountId == attempt.ProviderFundAccountId && remote.Reference == p.Id.ToString("N") && Enum.IsDefined(remote.Status);
            if (p.Status == PayoutStatus.Failed && remote?.Status != GatewayPayoutStatus.Failed) matched = false;
            var hash = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(remote)));
            var eventId = remote?.EventId ?? "missing:" + attempt.Id;
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({eventId}, 93))", ct);
            var prior = await db.Events.SingleOrDefaultAsync(e => e.ProviderEventId == eventId, ct);
            if (prior is not null)
            {
                BusinessRuleException.Require(prior.PayloadHash == hash && prior.PayoutAttemptId == attempt.Id, "PROVIDER_EVENT_REUSED", "Provider event identity was reused with different content.");
                return await View(p, ct);
            }
            db.Events.Add(new(p.Id, attempt.Id, attempt.ProviderPayoutId, eventId, hash, remote?.Status ?? GatewayPayoutStatus.Pending, matched, clock.UtcNow));
            if (!matched)
            {
                p.Observe(PayoutStatus.ReconciliationRequired, clock.UtcNow);
                await History(p, actor, "PAYOUT_RECONCILIATION_MISMATCH", "Provider identity, amount, currency, destination, reference or terminal status did not match. Hold requires review.", tx, ct);
            }
            else
            {
                await History(p, actor, "PAYOUT_RECONCILIATION_MATCHED", "Authoritative provider state matched the immutable instruction.", tx, ct);
                if (remote!.Status == GatewayPayoutStatus.Success)
                {
                    await db.SaveChangesAsync(ct); // trusted ledger adapter sees the verified immutable observation
                    p.Settle(await ledger.SettlePayoutAsync(id, tx, ct), clock.UtcNow);
                    await History(p, actor, "PAYOUT_SUCCEEDED", "Matched fake provider success settled the liability once.", tx, ct);
                    if (p.PayoutType == PayoutType.MemberAuctionBenefit) await History(p, actor, "AUCTION_BENEFIT_SETTLED", "Member benefit independently settled.", tx, ct);
                }
                else
                {
                    p.Observe(remote.Status == GatewayPayoutStatus.Failed ? PayoutStatus.Failed : PayoutStatus.ProviderPending, clock.UtcNow);
                    await History(p, actor, remote.Status == GatewayPayoutStatus.Failed ? "PAYOUT_FAILED" : "PAYOUT_PROVIDER_PENDING", "Liability remains outstanding; no settlement journal posted.", tx, ct);
                }
            }
            await db.SaveChangesAsync(ct);
            if (c.Active) await Evaluate(c.CycleId, actor, tx, ct);
            return await View(p, ct);
        }, ct);
    }
    public async Task<bool> EvaluateCycleSettlementAsync(Guid cycle, Guid actor, bool admin, CancellationToken ct)
    {
        approval.EnsureOperator(admin, actor, null); await using var tx = await db.Database.BeginTransactionAsync(ct);
        var c = await cycles.ReadLockedAsync(cycle, tx.GetDbTransaction(), ct);
        if (c.Status == "Completed") { await tx.CommitAsync(ct); return true; }
        Active(c); var result = await Evaluate(cycle, actor, tx.GetDbTransaction(), ct); await tx.CommitAsync(ct); return result;
    }
    private async Task<bool> Evaluate(Guid cycle, Guid actor, DbTransaction tx, CancellationToken ct)
    {
        var rows = await db.Obligations.Where(p => p.CycleId == cycle).ToArrayAsync(ct);
        if (rows.Length == 0 || rows.Any(p => p.Status != PayoutStatus.Succeeded)) return false;
        var c = await cycles.ReadLockedAsync(cycle, tx, ct);
        var s = await sources.ReadLockedAsync(Event(c), c.SelectionResultId, tx, ct);
        BusinessRuleException.Require(rows.Count(p => p.PayoutType == PayoutType.WinnerPayout && p.MembershipId == s.WinnerMembershipId && p.Amount == s.WinnerPayout) == 1 &&
            rows.Length == 1 + s.Benefits.Count + (s.PlatformFee > 0 ? 1 : 0) && rows.Sum(p => p.Amount) == s.GroupValue &&
            s.Benefits.All(b => rows.Count(p => p.PayoutType == PayoutType.MemberAuctionBenefit && p.MembershipId == b.MembershipId && p.Amount == b.Amount) == 1) &&
            (s.PlatformFee == 0 || rows.Count(p => p.PayoutType == PayoutType.PlatformFeeSettlement && p.Amount == s.PlatformFee) == 1),
            "CYCLE_SETTLEMENT_INCOMPLETE", "Every immutable source allocation must be fully settled.");
        await cycles.CompleteAndOpenNextAsync(cycle, actor, tx, clock.UtcNow, ct); return true;
    }
    private async Task<T> WithPayout<T>(Guid id, Func<PayoutObligation, SettlementCycle, DbTransaction, Task<T>> action, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var cycle = await db.Obligations.Where(p => p.Id == id).Select(p => (Guid?)p.CycleId).SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Payout not found.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await cycles.ReadLockedAsync(cycle, tx.GetDbTransaction(), ct);
        var p = await db.Obligations.FromSqlInterpolated($"SELECT * FROM payouts.\"PayoutObligations\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(ct);
        var result = await action(p, source, tx.GetDbTransaction()); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
    }
    private async Task History(PayoutObligation p, Guid actor, string action, string message, DbTransaction tx, CancellationToken ct)
    { db.History.Add(new(p.Id, actor, action, message, clock.UtcNow)); await Audit(p.Id, actor, action, tx, ct); }
    private async Task Audit(Guid subject, Guid actor, string action, DbTransaction tx, CancellationToken ct)
    {
        await using var audit = new AuditDbContext(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql(tx.Connection!).Options);
        await audit.Database.UseTransactionAsync(tx, ct); audit.AuditLogs.Add(AuditLog.Create(actor, action, "Payout", subject.ToString(), clock.UtcNow, null)); await audit.SaveChangesAsync(ct);
    }
}
