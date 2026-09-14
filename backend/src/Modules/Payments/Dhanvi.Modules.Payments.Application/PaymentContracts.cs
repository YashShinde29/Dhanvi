using Dhanvi.Modules.Payments.Domain;
namespace Dhanvi.Modules.Payments.Application;

public sealed record GatewayOrder(string Id, long Amount, string Currency, string Receipt, string Status, int Attempts = 0);
public sealed record GatewayPayment(string Id, string OrderId, long Amount, string Currency, string Status, bool Captured, long AmountRefunded, DateTimeOffset CreatedAt);
public sealed record GatewayRefund(string Id, string PaymentId, long Amount, string Status);
public sealed record GatewayEvent(string Type, GatewayPayment? Payment, GatewayRefund? Refund);
public interface IPaymentGateway
{
    string PublicKey { get; }
    bool Enabled { get; }
    Task<GatewayOrder> CreateOrderAsync(Guid paymentId, Guid contributionId, Guid groupId, Guid cycleId, long amount, string receipt, CancellationToken ct);
    Task<GatewayOrder> GetOrderAsync(string id, CancellationToken ct);
    Task<IReadOnlyList<GatewayOrder>> FindOrdersAsync(string receipt, CancellationToken ct);
    Task<GatewayPayment> GetPaymentAsync(string id, CancellationToken ct);
    Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(string order, CancellationToken ct);
    bool VerifyPaymentSignature(string order, string payment, string signature);
    bool VerifyWebhookSignature(ReadOnlyMemory<byte> body, string signature);
    GatewayEvent ParseWebhook(ReadOnlyMemory<byte> body);
}
public sealed record VerifyPaymentRequest(string RazorpayOrderId, string RazorpayPaymentId, string RazorpaySignature);
public sealed record PaymentView(Guid Id, Guid ContributionId, Guid GroupId, string GroupName, Guid CycleId, int CycleNumber,
    Guid MembershipId, Guid UserId, string MemberName, decimal Amount, string Currency, string Provider, string Environment,
    string? ProviderOrderId, string? ProviderPaymentId, PaymentStatus Status, int AttemptNumber, ReconciliationStatus ReconciliationStatus,
    string? ReconciliationMessage, DateTimeOffset? LastReconciledAt, DateTimeOffset CreatedAt, DateTimeOffset? CapturedAt,
    DateTimeOffset? SettledAt, DateTimeOffset? RefundedAt, Guid? JournalId, Guid? ReversalJournalId, string? FailureReason);
public sealed record CheckoutView(PaymentView Payment, string KeyId, long AmountInMinorUnits, bool CheckoutAllowed);
public sealed record PaymentEligibility(string CollectionMode, decimal FinanciallySettledAmount, string FinancialStatus,
    decimal RemainingAmount, bool CanPay, string? Reason, Guid? PaymentId);
public sealed record PaymentDetails(PaymentView Payment, IReadOnlyList<PaymentHistory> Timeline, IReadOnlyList<PaymentProviderEvent> Events, IReadOnlyList<PaymentRefund> Refunds);
public sealed record PaymentPage(IReadOnlyList<PaymentView> Items, int TotalCount, int Page, int PageSize,
    int Captured, int Pending, int Failed, int ReconciliationRequired);
public interface IPaymentService
{
    Task<PaymentEligibility> EligibilityAsync(Guid contributionId, Guid userId, CancellationToken ct);
    Task<CheckoutView> CreateAsync(Guid contributionId, Guid userId, string key, CancellationToken ct);
    Task<PaymentView> VerifyAsync(Guid id, Guid userId, VerifyPaymentRequest request, CancellationToken ct);
    Task<PaymentView> ReconcileAsync(Guid id, Guid actor, bool admin, CancellationToken ct);
    Task ProcessWebhookAsync(ReadOnlyMemory<byte> body, string signature, string? providerEventId, CancellationToken ct);
    Task<PaymentDetails> DetailsAsync(Guid id, Guid actor, bool admin, CancellationToken ct);
    Task<PaymentPage> ListAsync(Guid actor, bool admin, int page, int pageSize, PaymentStatus? status, CancellationToken ct);
}
