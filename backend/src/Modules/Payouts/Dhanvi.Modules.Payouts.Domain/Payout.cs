using System.Text.RegularExpressions;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Payouts.Domain;

public enum PayoutType { WinnerPayout, MemberAuctionBenefit, PlatformFeeSettlement }
public enum PayoutStatus { PendingBeneficiary, ApprovalRequired, Approved, Processing, ProviderPending, Succeeded, Failed, ReconciliationRequired, Cancelled }
public enum GatewayPayoutStatus { Pending, Success, Failed }
public enum BeneficiaryStatus { FormatValidated, ProviderVerified }

public static class PayoutMoney
{
    public static void Validate(decimal amount) => BusinessRuleException.Require(amount > 0 && amount <= 9999999999999999.99m && decimal.Round(amount, 2) == amount,
        "PAYOUT_AMOUNT_MISMATCH", "Payout must be a positive exact currency amount.");
}
// Append-only versions. Raw account numbers never enter this entity.
public sealed class PayoutBeneficiary
{
    private PayoutBeneficiary() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid UserId { get; private set; }
    public string Provider { get; private set; } = "FAKE";
    public string ProviderFundAccountId { get; private set; } = "";
    public string AccountType { get; private set; } = "BANK_ACCOUNT";
    public string MaskedAccountNumber { get; private set; } = "";
    public string AccountHolderName { get; private set; } = "";
    public string BankName { get; private set; } = "";
    public string Ifsc { get; private set; } = "";
    public BeneficiaryStatus Status { get; private set; } = BeneficiaryStatus.FormatValidated;
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset AvailableAt { get; private set; }
    public static void Validate(string holder, string account, string confirmation, string ifsc, string? bank)
    {
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(holder) && holder.Length <= 100 && (bank?.Length ?? 0) <= 100 &&
            account is not null && Regex.IsMatch(account, "^[0-9]{9,18}$", RegexOptions.CultureInvariant) && account == confirmation &&
            ifsc is not null && Regex.IsMatch(ifsc, "^[A-Z]{4}0[A-Z0-9]{6}$", RegexOptions.CultureInvariant),
            "INVALID_PAYOUT_ACCOUNT", "Supply a holder name, matching 9–18 digit account numbers, and a valid IFSC format.");
    }
    public static PayoutBeneficiary Create(Guid user, string token, string holder, string lastFour, string ifsc, string bank, DateTimeOffset now, bool changed)
    {
        BusinessRuleException.Require(user != Guid.Empty && token.StartsWith("fake_fa_", StringComparison.Ordinal) && Regex.IsMatch(lastFour, "^[0-9]{4}$", RegexOptions.CultureInvariant), "INVALID_PAYOUT_ACCOUNT", "A fake provider reference and masked destination are required.");
        return new() { UserId = user, ProviderFundAccountId = token, AccountHolderName = holder.Trim(), MaskedAccountNumber = "****" + lastFour,
            Ifsc = ifsc, BankName = bank.Trim(), CreatedAt = now, AvailableAt = changed ? now.AddHours(24) : now };
    }
}
public sealed class PayoutObligation
{
    private PayoutObligation() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public string GroupName { get; private set; } = "";
    public Guid CycleId { get; private set; }
    public int CycleNumber { get; private set; }
    public Guid? MembershipId { get; private set; }
    public Guid? UserId { get; private set; }
    public string MemberName { get; private set; } = "";
    public Guid SelectionResultId { get; private set; }
    public Guid? AuctionResultId { get; private set; }
    public Guid SourceId { get; private set; }
    public PayoutType PayoutType { get; private set; }
    public decimal Amount { get; private set; }
    public string Currency { get; private set; } = "INR";
    public string TimeZone { get; private set; } = "Asia/Kolkata";
    public PayoutStatus Status { get; private set; } = PayoutStatus.PendingBeneficiary;
    public Guid? BeneficiaryId { get; private set; }
    public Guid? ApprovedByUserId { get; private set; }
    public DateTimeOffset? ApprovedAt { get; private set; }
    public Guid AllocationJournalId { get; private set; }
    public Guid? SettlementJournalId { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? SettledAt { get; private set; }
    public int Version { get; private set; }
    public static PayoutObligation Create(Guid group, string groupName, Guid cycle, int number, Guid? membership, Guid? user, string name,
        Guid selection, Guid? auction, Guid source, PayoutType type, decimal amount, string zone, Guid journal, DateTimeOffset now)
    {
        PayoutMoney.Validate(amount);
        BusinessRuleException.Require(group != Guid.Empty && cycle != Guid.Empty && selection != Guid.Empty && source != Guid.Empty && journal != Guid.Empty &&
            Enum.IsDefined(type) && (type == PayoutType.PlatformFeeSettlement ? membership is null && user is null : membership.HasValue && user.HasValue),
            "INVALID_PAYOUT_SOURCE", "A finalized source, recipient and funded allocation journal are required.");
        return new() { GroupId = group, GroupName = groupName, CycleId = cycle, CycleNumber = number, MembershipId = membership, UserId = user, MemberName = name,
            SelectionResultId = selection, AuctionResultId = auction, SourceId = source, PayoutType = type, Amount = amount, TimeZone = zone, AllocationJournalId = journal, CreatedAt = now, UpdatedAt = now };
    }
    public void Approve(PayoutBeneficiary beneficiary, Guid actor, DateTimeOffset now)
    {
        BusinessRuleException.Require(Status is PayoutStatus.PendingBeneficiary or PayoutStatus.ApprovalRequired, "PAYOUT_NOT_READY", "Only an unapproved payout can be approved.");
        BusinessRuleException.Require(actor != UserId, "PAYOUT_SELF_APPROVAL_NOT_ALLOWED", "Recipients cannot approve their own payout.");
        BusinessRuleException.Require(beneficiary.UserId == UserId && beneficiary.AvailableAt <= now, "PAYOUT_BENEFICIARY_REQUIRED", "An eligible recipient beneficiary is required; account changes have a 24-hour hold.");
        BeneficiaryId = beneficiary.Id; ApprovedByUserId = actor; ApprovedAt = now; Status = PayoutStatus.Approved; Touch(now);
    }
    public void Begin(bool retry, DateTimeOffset now)
    {
        BusinessRuleException.Require(BeneficiaryId.HasValue, "PAYOUT_BENEFICIARY_REQUIRED", "Approve a beneficiary first.");
        BusinessRuleException.Require(ApprovedAt.HasValue, "PAYOUT_NOT_APPROVED", "Approval is required.");
        BusinessRuleException.Require(retry ? Status == PayoutStatus.Failed : Status == PayoutStatus.Approved, retry ? "PAYOUT_NOT_RETRYABLE" : "PAYOUT_NOT_APPROVED", "Payout is not eligible for this execution.");
        Status = PayoutStatus.Processing; Touch(now);
    }
    public void Observe(PayoutStatus status, DateTimeOffset now)
    {
        if (Status is PayoutStatus.Succeeded or PayoutStatus.ReconciliationRequired) return;
        BusinessRuleException.Require(status is PayoutStatus.ProviderPending or PayoutStatus.Failed or PayoutStatus.ReconciliationRequired,
            "PAYOUT_NOT_READY", "Only provider observations may update execution state.");
        Status = status; Touch(now);
    }
    public void Settle(Guid journal, DateTimeOffset now)
    {
        BusinessRuleException.Require(Status is PayoutStatus.Processing or PayoutStatus.ProviderPending, "PAYOUT_RECONCILIATION_REQUIRED", "A matched active attempt is required.");
        SettlementJournalId = journal; Status = PayoutStatus.Succeeded; SettledAt = now; Touch(now);
    }
    public void SettleInternalFee(DateTimeOffset now)
    {
        BusinessRuleException.Require(PayoutType == PayoutType.PlatformFeeSettlement && Status == PayoutStatus.PendingBeneficiary, "PAYOUT_NOT_READY", "Only the internally allocated fee can settle without a provider.");
        SettlementJournalId = AllocationJournalId; Status = PayoutStatus.Succeeded; SettledAt = now; Touch(now);
    }
    private void Touch(DateTimeOffset now) { UpdatedAt = now; Version++; }
}
// Intent is immutable. All provider outcomes live in append-only observation rows.
public sealed class PayoutAttempt
{
    private PayoutAttempt() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid PayoutObligationId { get; private set; }
    public int AttemptNumber { get; private set; }
    public string Provider { get; private set; } = "FAKE";
    public string ProviderPayoutId { get; private set; } = "";
    public string IdempotencyKey { get; private set; } = "";
    public string RequestKey { get; private set; } = "";
    public Guid BeneficiaryId { get; private set; }
    public string ProviderFundAccountId { get; private set; } = "";
    public string MaskedAccountNumber { get; private set; } = "";
    public decimal Amount { get; private set; }
    public string Currency { get; private set; } = "INR";
    public DateTimeOffset RequestedAt { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public static PayoutAttempt Create(PayoutObligation p, PayoutBeneficiary b, int number, string key, Guid actor, DateTimeOffset now)
    {
        BusinessRuleException.Require(p.Status == PayoutStatus.Processing && p.BeneficiaryId == b.Id && number > 0 && !string.IsNullOrWhiteSpace(key) && key.Length <= 200,
            "PAYOUT_NOT_READY", "Execution requires the approved destination and an idempotency key.");
        var a = new PayoutAttempt { PayoutObligationId = p.Id, AttemptNumber = number, BeneficiaryId = b.Id, ProviderFundAccountId = b.ProviderFundAccountId,
            MaskedAccountNumber = b.MaskedAccountNumber, Amount = p.Amount, RequestKey = key, RequestedAt = now, CreatedByUserId = actor };
        a.IdempotencyKey = "dhp_" + a.Id.ToString("N"); a.ProviderPayoutId = "fake_po_" + a.Id.ToString("N"); return a;
    }
}
public sealed class PayoutProviderEvent(Guid obligation, Guid attempt, string providerId, string eventKey, string hash, GatewayPayoutStatus status, bool matched, DateTimeOffset now)
{
    private PayoutProviderEvent() : this(default, default, "", "", "", default, false, default) { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid PayoutObligationId { get; private set; } = obligation;
    public Guid PayoutAttemptId { get; private set; } = attempt;
    public string Provider { get; private set; } = "FAKE";
    public string ProviderPayoutId { get; private set; } = providerId;
    public string ProviderEventId { get; private set; } = eventKey;
    public string PayloadHash { get; private set; } = hash;
    public GatewayPayoutStatus Status { get; private set; } = status;
    public bool Matched { get; private set; } = matched;
    public DateTimeOffset ReceivedAt { get; private set; } = now;
}
public sealed class PayoutHistory(Guid obligation, Guid actor, string action, string message, DateTimeOffset now)
{
    private PayoutHistory() : this(default, default, "", "", default) { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid PayoutObligationId { get; private set; } = obligation;
    public Guid ActorUserId { get; private set; } = actor;
    public string Action { get; private set; } = action;
    public string Message { get; private set; } = message;
    public DateTimeOffset CreatedAt { get; private set; } = now;
}
