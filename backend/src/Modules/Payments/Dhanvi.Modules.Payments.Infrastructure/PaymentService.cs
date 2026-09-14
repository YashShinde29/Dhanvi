using System.Data.Common;
using System.Security.Cryptography;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Domain;
using Dhanvi.Modules.Payments.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
namespace Dhanvi.Modules.Payments.Infrastructure;

internal sealed partial class PaymentService(PaymentsDbContext db, IContributionSettlementService contributions,
    IPaymentGateway gateway, ILedgerPostingService ledger, IDateTimeProvider clock, Microsoft.Extensions.Options.IOptions<RazorpayOptions> options) : IPaymentService
{
    private void Enabled() => BusinessRuleException.Require(gateway.Enabled, "PAYMENTS_DISABLED", "Razorpay Test payments are disabled.");
    private static void Own(Payment p, Guid user, bool admin) { if (!admin && p.UserId != user) throw new ForbiddenException("This payment belongs to another member."); }
    private static void Own(ContributionPaymentSource s, Guid user) { if (s.UserId != user) throw new ForbiddenException("This contribution belongs to another member."); }
    public async Task<PaymentEligibility> EligibilityAsync(Guid contributionId, Guid userId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await contributions.ReadLockedAsync(contributionId, tx.GetDbTransaction(), ct); Own(source, userId);
        var p = await db.Payments.AsNoTracking().SingleOrDefaultAsync(p => p.ContributionId == contributionId && p.RefundedAt == null, ct);
        var allowed = gateway.Enabled && source.CanCollect && (p is null || p.ProviderOrderId != null && p.Status is PaymentStatus.Pending or PaymentStatus.Failed);
        await tx.CommitAsync(ct);
        return new(source.CollectionMode, source.SettledAmount, source.FinancialStatus, source.ExpectedAmount - source.SettledAmount, allowed,
            allowed ? null : !gateway.Enabled ? "Razorpay Test collection is disabled." : source.SettledAmount > 0 ? "Contribution settled." : p is not null ? "Payment processing; check its status before retrying." : "This cycle is not open for gateway collection.", p?.Id);
    }
    public async Task<CheckoutView> CreateAsync(Guid contributionId, Guid userId, string key, CancellationToken ct)
    {
        Enabled();
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(key) && key.Length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key of at most 200 characters.");
        Payment p;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var source = await contributions.ReadLockedAsync(contributionId, tx.GetDbTransaction(), ct); Own(source, userId);
            var replay = await db.Payments.SingleOrDefaultAsync(p => p.ContributionId == contributionId && p.IdempotencyKey == key.Trim(), ct);
            if (replay is not null)
            {
                await tx.CommitAsync(ct);
                return Checkout(replay, source.CanCollect);
            }
            BusinessRuleException.Require(source.CanCollect, "CONTRIBUTION_NOT_PAYABLE", "Only an outstanding contribution in the current active Razorpay collection cycle can be paid.");
            var existing = await db.Payments.SingleOrDefaultAsync(p => p.ContributionId == contributionId && p.RefundedAt == null, ct);
            if (existing is not null) { await tx.CommitAsync(ct); return Checkout(existing, source.CanCollect); }
            var attempt = await db.Payments.CountAsync(p => p.ContributionId == contributionId, ct) + 1;
            p = Payment.Create(source.ContributionId, source.GroupId, source.CycleId, source.MembershipId, userId, source.GroupName, source.MemberName,
                source.CycleNumber, source.TimeZone, source.ExpectedAmount - source.SettledAmount, key, attempt, clock.UtcNow);
            db.Payments.Add(p); await db.SaveChangesAsync(ct);
            await History(p, userId, "PAYMENT_ORDER_REQUESTED", "Order intent reserved before provider request.", tx.GetDbTransaction(), ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        GatewayOrder order;
        try { order = await gateway.CreateOrderAsync(p.Id, p.ContributionId, p.GroupId, p.CycleId, PaymentMoney.ToMinorUnits(p.Amount), p.Receipt, ct); }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException)
        {
            // Intent remains durable even if the client disconnects. Never automatically repeat a POST.
            return await WithPayment(p.Id, userId, false, async (current, source, tx) => {
                current.Reconcile(ReconciliationStatus.Failed, "Order result is uncertain. Reconcile the receipt; do not create another order.", clock.UtcNow);
                await History(current, userId, "PAYMENT_ORDER_UNCERTAIN", current.ReconciliationMessage!, tx, CancellationToken.None);
                return Checkout(current, false);
            }, CancellationToken.None);
        }
        return await WithPayment(p.Id, userId, false, async (current, source, tx) => {
            if (!ValidOrder(current, order)) { await Mismatch(current, userId, "Provider order amount, currency, or receipt mismatch.", tx, ct); return Checkout(current, false); }
            current.SetOrder(order.Id, clock.UtcNow);
            await History(current, userId, "PAYMENT_ORDER_CREATED", "Razorpay Test order persisted.", tx, ct);
            return Checkout(current, source.CanCollect);
        }, ct);
    }
    private CheckoutView Checkout(Payment p, bool eligible) => new(View(p), gateway.PublicKey, PaymentMoney.ToMinorUnits(p.Amount),
        eligible && gateway.Enabled && p.ProviderOrderId is not null && p.Status is PaymentStatus.Pending or PaymentStatus.Failed);
    public async Task<PaymentView> VerifyAsync(Guid id, Guid userId, VerifyPaymentRequest request, CancellationToken ct)
    {
        Enabled(); var p = await Find(id, userId, false, ct);
        BusinessRuleException.Require(request.RazorpayOrderId == p.ProviderOrderId, "PAYMENT_ORDER_MISMATCH", "Order must match the server-created order.");
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(request.RazorpayPaymentId) && request.RazorpayPaymentId.Length <= 100 &&
            gateway.VerifyPaymentSignature(p.ProviderOrderId!, request.RazorpayPaymentId, request.RazorpaySignature ?? ""),
            "INVALID_PAYMENT_SIGNATURE", "Payment signature verification failed.");
        var payment = await gateway.GetPaymentAsync(request.RazorpayPaymentId, ct);
        var order = await gateway.GetOrderAsync(p.ProviderOrderId!, ct);
        return await WithPayment(id, userId, false, async (current, source, tx) => {
            if (payment.Id != request.RazorpayPaymentId) await Mismatch(current, userId, "Provider payment identity mismatch.", tx, ct);
            else
            {
                if (!await db.History.AnyAsync(h => h.PaymentId == id && h.Action == "PAYMENT_SIGNATURE_VERIFIED", ct))
                    await History(current, userId, "PAYMENT_SIGNATURE_VERIFIED", "Checkout signature verified server-side.", tx, ct);
                await Apply(current, source, payment, order, null, userId, tx, ct);
            }
            return View(current);
        }, ct);
    }
    public async Task<PaymentView> ReconcileAsync(Guid id, Guid actor, bool admin, CancellationToken ct)
    {
        Enabled(); var p = await Find(id, actor, admin, ct);
        GatewayOrder? order; GatewayPayment? payment;
        try
        {
            if (p.ProviderOrderId is null)
            {
                var orders = await gateway.FindOrdersAsync(p.Receipt, ct);
                order = orders.Count == 1 ? orders[0] : null;
            }
            else order = await gateway.GetOrderAsync(p.ProviderOrderId, ct);
            if (order is null)
                return await WithPayment(id, actor, admin, async (current, _, tx) => {
                    await Mismatch(current, actor, "Order receipt could not be resolved uniquely. No automatic new order.", tx, ct); return View(current);
                }, ct);
            var matches = await gateway.GetOrderPaymentsAsync(order.Id, ct);
            var successful = matches.Where(x => x.Captured || x.Status is "captured" or "refunded" or "authorized").ToArray();
            if (successful.Length > 1)
                return await WithPayment(id, actor, admin, async (current, _, tx) => {
                    await Mismatch(current, actor, "More than one successful provider payment needs review.", tx, ct); return View(current);
                }, ct);
            payment = successful.SingleOrDefault() ?? matches.OrderByDescending(x => x.CreatedAt).FirstOrDefault();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return await WithPayment(id, actor, admin, async (current, _, tx) => {
                current.Reconcile(ReconciliationStatus.Failed, "Provider lookup failed. Existing settlement remains unchanged.", clock.UtcNow);
                await History(current, actor, "PAYMENT_RECONCILIATION_FAILED", current.ReconciliationMessage!, tx, ct); return View(current);
            }, ct);
        }
        return await WithPayment(id, actor, admin, async (current, source, tx) => {
            if (!ValidOrder(current, order)) await Mismatch(current, actor, "Provider order mismatch.", tx, ct);
            else
            {
                current.SetOrder(order.Id, clock.UtcNow);
                if (payment is null)
                {
                    if (current.CapturedAt.HasValue || order.Status == "paid") await Mismatch(current, actor, "Captured payment missing from provider order.", tx, ct);
                    else current.Reconcile(ReconciliationStatus.Matched, "Order matched; awaiting a captured payment.", clock.UtcNow);
                }
                else await Apply(current, source, payment, order, null, actor, tx, ct);
                await History(current, actor, current.ReconciliationStatus == ReconciliationStatus.Mismatch ? "PAYMENT_RECONCILIATION_MISMATCH" : "PAYMENT_RECONCILIATION_MATCHED",
                    current.ReconciliationMessage ?? "Provider state inspected.", tx, ct);
            }
            return View(current);
        }, ct);
    }

    public async Task ProcessWebhookAsync(ReadOnlyMemory<byte> body, string signature, string? providerEventId, CancellationToken ct)
    {
        Enabled();
        BusinessRuleException.Require(options.Value.WebhookEnabled, "WEBHOOKS_DISABLED", "Razorpay webhooks are disabled.");
        BusinessRuleException.Require(gateway.VerifyWebhookSignature(body, signature), "INVALID_WEBHOOK_SIGNATURE", "Webhook signature verification failed.");
        var hash = Convert.ToHexStringLower(SHA256.HashData(body.Span));
        var key = string.IsNullOrWhiteSpace(providerEventId) ? "sha256:" + hash : providerEventId.Trim();
        BusinessRuleException.Require(key.Length <= 200, "INVALID_PROVIDER_EVENT", "Provider event identifier is too long.");
        var prior = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventKey == key, ct);
        if (prior is not null) { ValidateEvent(prior, hash); return; }
        var e = gateway.ParseWebhook(body); // only after exact-byte signature validation
        if (e.Type is not ("payment.authorized" or "payment.captured" or "payment.failed" or "order.paid" or "refund.created" or "refund.processed" or "refund.failed" or "payment.refunded"))
        {
            await StoreIgnored(key, e.Type, hash, ct); return;
        }
        var providerId = e.Refund?.PaymentId ?? e.Payment?.Id;
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(providerId), "INVALID_PROVIDER_EVENT", "Payment identity is missing.");
        var provider = await gateway.GetPaymentAsync(providerId!, ct);
        var order = await gateway.GetOrderAsync(provider.OrderId, ct);
        var id = await db.Payments.AsNoTracking().Where(p => p.ProviderOrderId == order.Id || p.Receipt == order.Receipt).Select(p => (Guid?)p.Id).SingleOrDefaultAsync(ct);
        // Unknown orders may belong to another application on the same test account. Preserve only the hash and safe IDs.
        if (id is null) { await StoreIgnored(key, e.Type, hash, ct); return; }
        await WithPayment(id.Value, Guid.Empty, true, async (p, source, tx) => {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 8))", ct);
            var existing = await db.Events.SingleOrDefaultAsync(x => x.EventKey == key, ct);
            if (existing is not null) { ValidateEvent(existing, hash); return true; }
            if (provider.Id != providerId || e.Payment is { } snapshot && (snapshot.OrderId != provider.OrderId || snapshot.Amount != provider.Amount || snapshot.Currency != provider.Currency))
                await Mismatch(p, p.UserId, "Webhook/provider identity or amount mismatch.", tx, ct);
            else await Apply(p, source, provider, order, e.Refund, p.UserId, tx, ct);
            db.Events.Add(PaymentProviderEvent.Create(key, e.Type, hash, provider.OrderId, provider.Id, p.Id,
                p.ReconciliationStatus == ReconciliationStatus.Mismatch ? "REVIEW_REQUIRED" : "PROCESSED", clock.UtcNow));
            return true;
        }, ct);
    }
    private static void ValidateEvent(PaymentProviderEvent e, string hash) => BusinessRuleException.Require(e.PayloadHash == hash, "PROVIDER_EVENT_REUSED", "Event identity was reused with a different payload.");
    private async Task StoreIgnored(string key, string type, string hash, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 8))", ct);
        var e = await db.Events.SingleOrDefaultAsync(e => e.EventKey == key, ct);
        if (e is not null) ValidateEvent(e, hash);
        else { db.Events.Add(PaymentProviderEvent.Create(key, type, hash, null, null, null, "IGNORED", clock.UtcNow)); await db.SaveChangesAsync(ct); }
        await tx.CommitAsync(ct);
    }
    private static bool ValidOrder(Payment p, GatewayOrder o) => !string.IsNullOrWhiteSpace(o.Id) && o.Id.Length <= 100 &&
        (p.ProviderOrderId is null || p.ProviderOrderId == o.Id) && o.Amount == PaymentMoney.ToMinorUnits(p.Amount) && o.Currency == p.Currency && o.Receipt == p.Receipt && o.Status is "created" or "attempted" or "paid";

    private async Task Apply(Payment p, ContributionPaymentSource source, GatewayPayment remote, GatewayOrder order, GatewayRefund? refund, Guid actor, DbTransaction tx, CancellationToken ct)
    {
        if (!ValidOrder(p, order) || remote.OrderId != order.Id || remote.Amount != PaymentMoney.ToMinorUnits(p.Amount) || remote.Currency != "INR" ||
            string.IsNullOrWhiteSpace(remote.Id) || remote.Id.Length > 100 || remote.AmountRefunded < 0 || remote.AmountRefunded > remote.Amount ||
            p.ProviderPaymentId is not null && p.ProviderPaymentId != remote.Id && remote.Status != "failed" ||
            remote.Status == "captured" && !remote.Captured || remote.Captured && (remote.Status is not ("captured" or "refunded") || order.Status != "paid"))
        { await Mismatch(p, actor, "Provider identity, amount, currency, or capture state mismatch.", tx, ct); return; }
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({remote.Id}, 9))", ct);
        if (await db.Payments.AnyAsync(x => x.Id != p.Id && x.ProviderPaymentId == remote.Id, ct))
        { await Mismatch(p, actor, "Provider payment already belongs to another internal payment.", tx, ct); return; }
        p.SetOrder(order.Id, clock.UtcNow);
        if (p.Status == PaymentStatus.ReconciliationRequired)
        {
            // Mismatches are sticky: generic reconciliation cannot silently release an accounting hold.
            return;
        }
        if (refund is not null)
        {
            if (string.IsNullOrWhiteSpace(refund.Id) || refund.Id.Length > 100 || refund.PaymentId != remote.Id || refund.Amount != remote.Amount || refund.Status is not ("pending" or "processed" or "failed"))
            { await Mismatch(p, actor, "Only a matching full refund can be applied.", tx, ct); return; }
            if (!await db.Refunds.AnyAsync(r => r.ProviderRefundId == refund.Id && r.Status == refund.Status, ct))
                db.Refunds.Add(PaymentRefund.Observed(p.Id, refund.Id, PaymentMoney.FromMinorUnits(refund.Amount), refund.Status, clock.UtcNow));
        }
        if (remote.AmountRefunded > 0 || refund?.Status == "processed" || remote.Status == "refunded")
        {
            if (remote.AmountRefunded != remote.Amount || source.SelectionCompleted || p.SettledAt is null)
            { await Mismatch(p, actor, "Refund requires a recorded full capture and an unselected cycle. Exceptional review required.", tx, ct); return; }
            if (!p.RefundedAt.HasValue)
            {
                var reversalId = Guid.NewGuid();
                var result = await ledger.ReverseInTransactionAsync(p.JournalId!.Value, reversalId, "Confirmed full Razorpay Test refund", actor, tx, ct);
                await contributions.ReverseAsync(p.ContributionId, p.Id, tx, clock.UtcNow, ct);
                p.Refund(result.JournalId!.Value, clock.UtcNow);
                await History(p, actor, "PAYMENT_REFUNDED", "Full refund confirmed; contribution settlement reversed.", tx, ct);
            }
        }
        else if (remote.Status == "captured" && remote.Captured)
        {
            if (!p.CapturedAt.HasValue)
            {
                if (source.SettledAmount != 0 || source.SelectionCompleted || source.CollectionMode != "Razorpay")
                { await Mismatch(p, actor, "Capture cannot be applied to this contribution; over-settlement prevented.", tx, ct); return; }
                p.Observe(remote.Id, PaymentStatus.Captured, clock.UtcNow, clock.UtcNow);
                await db.SaveChangesAsync(ct); // visible to the trusted Ledger source reader in this same transaction
                await contributions.SettleAsync(p.ContributionId, p.Id, p.Amount, tx, clock.UtcNow, ct);
                p.Settle(await ledger.CapturePaymentAsync(p.Id, tx, ct), clock.UtcNow);
                await History(p, actor, "PAYMENT_CAPTURED", "Verified test capture financially settled the contribution.", tx, ct);
            }
            if (refund?.Status == "failed" && p.Status == PaymentStatus.RefundPending)
            {
                p.RefundFailed(clock.UtcNow);
                await History(p, actor, "PAYMENT_REFUND_FAILED", "Provider refund failed; captured settlement remains in place.", tx, ct);
            }
            if (refund?.Status == "pending" && p.Status != PaymentStatus.RefundPending &&
                !await db.Refunds.AnyAsync(r => r.ProviderRefundId == refund.Id && (r.Status == "failed" || r.Status == "processed"), ct))
            {
                p.RefundPending(clock.UtcNow);
                await History(p, actor, "PAYMENT_REFUND_REQUESTED", "Provider reports a full refund pending; no reversal until confirmation.", tx, ct);
            }
        }
        else if (remote.Status is "authorized" or "failed")
        {
            if (p.Observe(remote.Id, remote.Status == "authorized" ? PaymentStatus.Authorized : PaymentStatus.Failed, remote.CreatedAt, clock.UtcNow))
                await History(p, actor, remote.Status == "authorized" ? "PAYMENT_AUTHORIZED" : "PAYMENT_FAILED", "Provider status observed; no financial settlement.", tx, ct);
        }
        else { await Mismatch(p, actor, "Unsupported provider payment state.", tx, ct); return; }
        p.Reconcile(ReconciliationStatus.Matched, "Order, payment identity, amount, currency and provider state matched. Bank settlement is not implied.", clock.UtcNow);
    }
    private async Task Mismatch(Payment p, Guid actor, string reason, DbTransaction tx, CancellationToken ct)
    {
        p.Reconcile(ReconciliationStatus.Mismatch, reason, clock.UtcNow);
        await History(p, actor, "PAYMENT_RECONCILIATION_MISMATCH", reason, tx, ct);
    }
    private async Task History(Payment p, Guid actor, string action, string message, DbTransaction tx, CancellationToken ct)
    {
        db.History.Add(PaymentHistory.Create(p.Id, actor, action, message, clock.UtcNow));
        await using var audit = new AuditDbContext(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql(tx.Connection!).Options);
        await audit.Database.UseTransactionAsync(tx, ct);
        audit.AuditLogs.Add(AuditLog.Create(actor, action, "Payment", p.Id.ToString(), clock.UtcNow, null)); await audit.SaveChangesAsync(ct);
    }
    private async Task<Payment> Find(Guid id, Guid actor, bool admin, CancellationToken ct)
    { var p = await db.Payments.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id, ct) ?? throw new NotFoundException("Payment not found."); Own(p, actor, admin); return p; }
    private async Task<T> WithPayment<T>(Guid id, Guid actor, bool admin, Func<Payment, ContributionPaymentSource, DbTransaction, Task<T>> action, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var initial = await Find(id, actor, admin, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await contributions.ReadLockedAsync(initial.ContributionId, tx.GetDbTransaction(), ct);
        var p = await db.Payments.FromSqlInterpolated($"SELECT * FROM payments.\"Payments\" WHERE \"Id\" = {id} FOR UPDATE").SingleAsync(ct);
        var result = await action(p, source, tx.GetDbTransaction()); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
    }
    internal static PaymentView View(Payment p) => new(p.Id, p.ContributionId, p.GroupId, p.GroupName, p.CycleId, p.CycleNumber, p.MembershipId, p.UserId,
        p.MemberName, p.Amount, p.Currency, p.Provider, p.Environment, p.ProviderOrderId, p.ProviderPaymentId, p.Status, p.AttemptNumber,
        p.ReconciliationStatus, p.ReconciliationMessage, p.LastReconciledAt, p.CreatedAt, p.CapturedAt, p.SettledAt, p.RefundedAt, p.JournalId, p.ReversalJournalId, p.FailureReason);
}
internal sealed class CapturedPaymentReader : ICapturedPaymentReader
{
    public async Task<CapturedPaymentSource> ReadAsync(Guid paymentId, DbTransaction transaction, CancellationToken ct)
    {
        await using var db = new PaymentsDbContext(new DbContextOptionsBuilder<PaymentsDbContext>().UseNpgsql(transaction.Connection!).Options);
        await db.Database.UseTransactionAsync(transaction, ct);
        var p = await db.Payments.SingleAsync(p => p.Id == paymentId, ct);
        BusinessRuleException.Require(p.Status == PaymentStatus.Captured && p.CapturedAt.HasValue && p.ProviderPaymentId is not null && p.Environment == "TEST",
            "PAYMENT_NOT_CAPTURED", "Ledger requires a verified test capture.");
        return new(p.Id, p.ContributionId, p.GroupId, p.CycleId, p.MembershipId, p.UserId, p.Amount, p.BusinessTimeZone, p.CapturedAt!.Value, p.ProviderPaymentId!);
    }
}
