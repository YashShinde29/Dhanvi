using Dhanvi.Modules.Payouts.Domain;
namespace Dhanvi.Modules.Payouts.Application;
public sealed record PayoutAccountRequest(string AccountHolderName, string AccountNumber, string ConfirmAccountNumber, string Ifsc, string? BankName, string Password);
public sealed record BeneficiaryView(Guid Id, string MaskedAccountNumber, string AccountHolderName, string BankName, string Ifsc, BeneficiaryStatus Status, DateTimeOffset CreatedAt, DateTimeOffset AvailableAt);
public sealed record GatewayPayoutRequest(string ProviderPayoutId, string IdempotencyKey, string FundAccountId, decimal Amount, string Currency, string Reference);
public sealed record GatewayPayout(string Id, string FundAccountId, decimal Amount, string Currency, string Reference, GatewayPayoutStatus Status, string EventId);
public interface IPayoutGateway
{
    string Provider { get; }
    Task<string> CreateFundAccountAsync(Guid reference, CancellationToken ct);
    Task<GatewayPayout> InitiatePayoutAsync(GatewayPayoutRequest request, CancellationToken ct);
    Task<GatewayPayout?> GetPayoutStatusAsync(string providerId, CancellationToken ct);
}
public interface IPayoutApprovalPolicy { void EnsureOperator(bool admin, Guid actor, Guid? recipient); }
public sealed class AdminPayoutApprovalPolicy : IPayoutApprovalPolicy
{
    public void EnsureOperator(bool admin, Guid actor, Guid? recipient)
    {
        if (!admin) throw new Dhanvi.SharedKernel.Exceptions.ForbiddenException("Admin or SuperAdmin payout authorization is required.");
        Dhanvi.SharedKernel.Exceptions.BusinessRuleException.Require(actor != recipient, "PAYOUT_SELF_APPROVAL_NOT_ALLOWED", "Recipients cannot approve or execute their own payouts.");
    }
}
public sealed record PayoutView(Guid Id, Guid GroupId, string GroupName, Guid CycleId, int CycleNumber, string MemberName, PayoutType PayoutType,
    decimal Amount, string Currency, PayoutStatus Status, string? MaskedAccountNumber, Guid SelectionResultId, Guid? AuctionResultId,
    Guid AllocationJournalId, Guid? SettlementJournalId, DateTimeOffset CreatedAt, DateTimeOffset? ApprovedAt, DateTimeOffset? SettledAt,
    /// <summary>Whether the recipient's latest payout account is usable now (an approval would succeed). Internal fees are always true.</summary>
    bool BeneficiaryAvailable = false);
public sealed record AttemptView(Guid Id, int AttemptNumber, string Provider, string ProviderPayoutId, decimal Amount, string MaskedAccountNumber,
    DateTimeOffset RequestedAt, string Status, DateTimeOffset? CompletedAt, string? FailureCode);
public sealed record PayoutHistoryView(Guid Id, string Action, string Message, DateTimeOffset CreatedAt);
public sealed record PayoutEventView(Guid Id, string ProviderEventId, GatewayPayoutStatus Status, bool Matched, DateTimeOffset ReceivedAt);
public sealed record PayoutDetails(PayoutView Payout, IReadOnlyList<AttemptView> Attempts, IReadOnlyList<PayoutHistoryView> Timeline, IReadOnlyList<PayoutEventView> Events);
public sealed record PayoutPage(IReadOnlyList<PayoutView> Items, int TotalCount, int Page, int PageSize, IReadOnlyDictionary<string, int> Summary);
public sealed record PayoutFilter(Guid? CycleId, DateTimeOffset? From, DateTimeOffset? To);
public interface IPayoutService
{
    Task<BeneficiaryView?> AccountAsync(Guid user, CancellationToken ct);
    Task<BeneficiaryView> AddAccountAsync(Guid user, PayoutAccountRequest request, CancellationToken ct);
    Task<IReadOnlyList<PayoutView>> PrepareCycleSettlementAsync(Guid cycle, Guid actor, bool admin, CancellationToken ct);
    Task<PayoutView> ApproveAsync(Guid id, Guid actor, bool admin, CancellationToken ct);
    Task<PayoutView> ExecuteAsync(Guid id, Guid actor, bool admin, string key, bool retry, CancellationToken ct);
    Task<PayoutView> ReconcileAsync(Guid id, Guid actor, bool admin, CancellationToken ct);
    Task<bool> EvaluateCycleSettlementAsync(Guid cycle, Guid actor, bool admin, CancellationToken ct);
    Task<PayoutPage> ListAsync(Guid actor, bool admin, Guid? group, int page, PayoutStatus? status, PayoutType? type, CancellationToken ct, PayoutFilter? filter = null);
    Task<PayoutDetails> DetailsAsync(Guid id, Guid actor, bool admin, CancellationToken ct);
}
