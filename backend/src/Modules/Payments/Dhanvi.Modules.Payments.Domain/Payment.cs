using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Payments.Domain;

public enum PaymentStatus { Created, Pending, Authorized, Captured, Failed, Cancelled, RefundPending, Refunded, ReconciliationRequired }
public enum ReconciliationStatus { Pending, Matched, Mismatch, Failed }
public static class PaymentMoney
{
    public static long ToMinorUnits(decimal amount)
    {
        BusinessRuleException.Require(amount > 0 && amount <= 9999999999999999.99m && decimal.Round(amount, 2) == amount,
            "INVALID_PAYMENT_AMOUNT", "Amount must be positive and exact to paise.");
        return checked((long)(amount * 100m));
    }
    public static decimal FromMinorUnits(long amount)
    {
        BusinessRuleException.Require(amount >= 0, "INVALID_PAYMENT_AMOUNT", "Minor units cannot be negative.");
        return amount / 100m;
    }
}
public sealed class Payment
{
    private Payment() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid ContributionId { get; private set; }
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public Guid MembershipId { get; private set; }
    public Guid UserId { get; private set; }
    public string GroupName { get; private set; } = "";
    public string MemberName { get; private set; } = "";
    public int CycleNumber { get; private set; }
    public string BusinessTimeZone { get; private set; } = "";
    public string Provider { get; private set; } = "RAZORPAY";
    public string Environment { get; private set; } = "TEST";
    public string? ProviderOrderId { get; private set; }
    public string? ProviderPaymentId { get; private set; }
    public decimal Amount { get; private set; }
    public string Currency { get; private set; } = "INR";
    public PaymentStatus Status { get; private set; } = PaymentStatus.Created;
    public int AttemptNumber { get; private set; }
    public string IdempotencyKey { get; private set; } = "";
    public string Receipt { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? AuthorizedAt { get; private set; }
    public DateTimeOffset? CapturedAt { get; private set; }
    public DateTimeOffset? FailedAt { get; private set; }
    public DateTimeOffset? RefundedAt { get; private set; }
    public DateTimeOffset? SettledAt { get; private set; }
    public Guid? JournalId { get; private set; }
    public Guid? ReversalJournalId { get; private set; }
    public string? FailureCode { get; private set; }
    public string? FailureReason { get; private set; }
    public ReconciliationStatus ReconciliationStatus { get; private set; } = ReconciliationStatus.Pending;
    public DateTimeOffset? LastReconciledAt { get; private set; }
    public string? ReconciliationMessage { get; private set; }
    public int Version { get; private set; }

    public static Payment Create(Guid contribution, Guid group, Guid cycle, Guid membership, Guid user, string groupName,
        string memberName, int cycleNumber, string zone, decimal amount, string key, int attempt, DateTimeOffset now)
    {
        _ = PaymentMoney.ToMinorUnits(amount);
        BusinessRuleException.Require(contribution != Guid.Empty && group != Guid.Empty && cycle != Guid.Empty && membership != Guid.Empty && user != Guid.Empty &&
            !string.IsNullOrWhiteSpace(key) && key.Length <= 200 && attempt > 0, "INVALID_PAYMENT", "A payment needs valid source references and idempotency key.");
        var p = new Payment { ContributionId = contribution, GroupId = group, CycleId = cycle, MembershipId = membership, UserId = user,
            GroupName = groupName, MemberName = memberName, CycleNumber = cycleNumber, BusinessTimeZone = zone, Amount = amount,
            IdempotencyKey = key.Trim(), AttemptNumber = attempt, CreatedAt = now.ToUniversalTime(), UpdatedAt = now.ToUniversalTime() };
        p.Receipt = $"dh_{p.Id:N}";
        return p;
    }
    public void SetOrder(string order, DateTimeOffset now)
    {
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(order) && order.Length <= 100 && (ProviderOrderId is null || ProviderOrderId == order),
            "PAYMENT_ORDER_MISMATCH", "The provider order does not match this payment.");
        ProviderOrderId = order;
        if (Status == PaymentStatus.Created) Status = PaymentStatus.Pending;
        Touch(now);
    }
    public bool Observe(string paymentId, PaymentStatus status, DateTimeOffset occurred, DateTimeOffset now)
    {
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(paymentId) && paymentId.Length <= 100 &&
            status is PaymentStatus.Authorized or PaymentStatus.Captured or PaymentStatus.Failed, "INVALID_PAYMENT_TRANSITION", "Unsupported payment observation.");
        if (Status == PaymentStatus.ReconciliationRequired) return false;
        if (CapturedAt.HasValue || Status is PaymentStatus.RefundPending or PaymentStatus.Refunded) return false;
        if (status == PaymentStatus.Failed)
        {
            if (Status == PaymentStatus.Authorized || Status == PaymentStatus.Failed) return false;
            Status = status; FailedAt = occurred.ToUniversalTime(); FailureCode = "GATEWAY_FAILED";
            FailureReason = "The gateway did not capture this attempt."; Touch(now); return true;
        }
        BusinessRuleException.Require(ProviderPaymentId is null || ProviderPaymentId == paymentId, "PAYMENT_ID_MISMATCH", "A different provider payment is already bound.");
        ProviderPaymentId = paymentId;
        if (Status == status) return false;
        Status = status;
        if (status == PaymentStatus.Authorized) AuthorizedAt = occurred.ToUniversalTime();
        if (status == PaymentStatus.Captured) CapturedAt = occurred.ToUniversalTime();
        FailureCode = null; FailureReason = null; Touch(now); return true;
    }
    public void Settle(Guid journal, DateTimeOffset now)
    {
        BusinessRuleException.Require(Status == PaymentStatus.Captured && !SettledAt.HasValue && journal != Guid.Empty,
            "INVALID_PAYMENT_SETTLEMENT", "Only an unsettled capture can settle.");
        JournalId = journal; SettledAt = now.ToUniversalTime(); Touch(now);
    }
    public void RefundPending(DateTimeOffset now)
    {
        if (Status == PaymentStatus.Refunded) return;
        BusinessRuleException.Require(CapturedAt.HasValue && SettledAt.HasValue, "INVALID_REFUND", "A settled capture is required.");
        Status = PaymentStatus.RefundPending; Touch(now);
    }
    public void Refund(Guid journal, DateTimeOffset now)
    {
        BusinessRuleException.Require(SettledAt.HasValue && !RefundedAt.HasValue, "INVALID_REFUND", "Only a settled capture can be refunded.");
        Status = PaymentStatus.Refunded; RefundedAt = now.ToUniversalTime(); ReversalJournalId = journal; Touch(now);
    }
    public void RefundFailed(DateTimeOffset now)
    {
        if (Status != PaymentStatus.RefundPending) return;
        Status = PaymentStatus.Captured; Touch(now);
    }
    public void Reconcile(ReconciliationStatus result, string message, DateTimeOffset now)
    {
        ReconciliationStatus = result; ReconciliationMessage = message; LastReconciledAt = now.ToUniversalTime();
        if (result == ReconciliationStatus.Mismatch) Status = PaymentStatus.ReconciliationRequired;
        Touch(now);
    }
    private void Touch(DateTimeOffset now) { UpdatedAt = now.ToUniversalTime(); Version++; }
}

// Final processing outcome is inserted in the same transaction as settlement. Never store raw payloads or signatures.
public sealed class PaymentProviderEvent
{
    private PaymentProviderEvent() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string Provider { get; private set; } = "RAZORPAY";
    public string EventKey { get; private set; } = "";
    public string EventType { get; private set; } = "";
    public string PayloadHash { get; private set; } = "";
    public string? ProviderOrderId { get; private set; }
    public string? ProviderPaymentId { get; private set; }
    public Guid? PaymentId { get; private set; }
    public DateTimeOffset ReceivedAt { get; private set; }
    public DateTimeOffset ProcessedAt { get; private set; }
    public string ProcessingStatus { get; private set; } = "";
    public static PaymentProviderEvent Create(string key, string type, string hash, string? order, string? payment,
        Guid? id, string status, DateTimeOffset now) => new() { EventKey = key, EventType = type, PayloadHash = hash,
            ProviderOrderId = order, ProviderPaymentId = payment, PaymentId = id, ProcessingStatus = status,
            ReceivedAt = now.ToUniversalTime(), ProcessedAt = now.ToUniversalTime() };
}
public sealed class PaymentHistory
{
    private PaymentHistory() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid PaymentId { get; private set; }
    public Guid ActorId { get; private set; }
    public string Action { get; private set; } = "";
    public string Message { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    public static PaymentHistory Create(Guid payment, Guid actor, string action, string message, DateTimeOffset now) =>
        new() { PaymentId = payment, ActorId = actor, Action = action, Message = message, CreatedAt = now.ToUniversalTime() };
}
public sealed class PaymentRefund
{
    private PaymentRefund() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid PaymentId { get; private set; }
    public string ProviderRefundId { get; private set; } = "";
    public decimal Amount { get; private set; }
    public string Status { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    public static PaymentRefund Observed(Guid payment, string providerId, decimal amount, string status, DateTimeOffset now) =>
        new() { PaymentId = payment, ProviderRefundId = providerId, Amount = amount, Status = status, CreatedAt = now.ToUniversalTime() };
}
