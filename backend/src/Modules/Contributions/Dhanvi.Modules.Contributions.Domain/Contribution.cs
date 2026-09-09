using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Contributions.Domain;

public enum ContributionStatus { Pending, Partial, Recorded, Overdue, Reversed }
public enum ContributionEntryType { Record, Reversal }

public sealed class Contribution
{
    private Contribution() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public Guid CycleId { get; private set; }
    public Guid MembershipId { get; private set; }
    public decimal ExpectedAmount { get; private set; }
    public decimal RecordedAmount { get; private set; }
    public ContributionStatus Status { get; private set; } = ContributionStatus.Pending;
    public DateOnly DueDate { get; private set; }
    public DateTimeOffset? RecordedAt { get; private set; }
    public DateTimeOffset? OverdueAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public int Version { get; private set; }
    public static Contribution Expect(Guid groupId, Guid cycleId, Guid membershipId, decimal amount, DateOnly dueDate, DateTimeOffset now)
    {
        ValidAmount(amount);
        return new() { GroupId = groupId, CycleId = cycleId, MembershipId = membershipId, ExpectedAmount = amount, DueDate = dueDate, CreatedAt = now, UpdatedAt = now };
    }
    public ContributionEntry Record(decimal amount, string reference, string? note, string key, Guid actor, DateOnly today, DateTimeOffset now)
    {
        ValidAmount(amount); ValidateText(reference, 200, "REFERENCE_REQUIRED"); ValidateText(key, 200, "IDEMPOTENCY_KEY_REQUIRED");
        BusinessRuleException.Require(note is null || note.Length <= 1000, "INVALID_NOTE", "Note must be at most 1000 characters.");
        BusinessRuleException.Require(amount <= ExpectedAmount - RecordedAmount, "CONTRIBUTION_OVER_RECORD", "Amount exceeds the remaining expected contribution.");
        RecordedAmount += amount; RecordedAt = now; UpdateStatus(today, now, false);
        return ContributionEntry.Record(Id, amount, reference.Trim(), note?.Trim(), key, actor, now);
    }
    public ContributionEntry Reverse(ContributionEntry original, string reason, string key, Guid actor, bool alreadyReversed, DateOnly today, DateTimeOffset now)
    {
        ValidateText(reason, 1000, "REASON_REQUIRED"); ValidateText(key, 200, "IDEMPOTENCY_KEY_REQUIRED");
        BusinessRuleException.Require(original.ContributionId == Id && original.EntryType == ContributionEntryType.Record, "INVALID_REVERSAL_TARGET", "Select an original record for this contribution.");
        BusinessRuleException.Require(!alreadyReversed, "ENTRY_ALREADY_REVERSED", "This record has already been reversed.");
        BusinessRuleException.Require(original.Amount <= RecordedAmount, "INVALID_REVERSAL_AMOUNT", "Reversal would make the contribution negative.");
        RecordedAmount -= original.Amount; UpdateStatus(today, now, true);
        return ContributionEntry.Reversal(original, reason.Trim(), key, actor, now);
    }
    public bool MarkOverdue(DateOnly today, DateTimeOffset now)
    {
        if (today <= DueDate || RecordedAmount == ExpectedAmount || Status == ContributionStatus.Overdue) return false;
        Status = ContributionStatus.Overdue; OverdueAt ??= now; UpdatedAt = now; Version++; return true;
    }
    private void UpdateStatus(DateOnly today, DateTimeOffset now, bool reversed)
    {
        Status = RecordedAmount == ExpectedAmount ? ContributionStatus.Recorded : RecordedAmount > 0 ? ContributionStatus.Partial : reversed ? ContributionStatus.Reversed : ContributionStatus.Pending;
        UpdatedAt = now; Version++; MarkOverdue(today, now);
    }
    private static void ValidAmount(decimal amount) => BusinessRuleException.Require(amount > 0 && amount <= 9999999999999999.99m && decimal.Round(amount, 2) == amount,
        "INVALID_CONTRIBUTION_AMOUNT", "Amount must be positive with at most two decimal places.");
    private static void ValidateText(string value, int limit, string code) => BusinessRuleException.Require(!string.IsNullOrWhiteSpace(value) && value.Length <= limit, code, $"A value of at most {limit} characters is required.");
}

// Operational history only. These entries do not represent money movement or accounting.
public sealed class ContributionEntry
{
    private ContributionEntry() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid ContributionId { get; private set; }
    public ContributionEntryType EntryType { get; private set; }
    public decimal Amount { get; private set; }
    public string Reference { get; private set; } = "";
    public string IdempotencyKey { get; private set; } = "";
    public Guid RecordedByUserId { get; private set; }
    public string? Note { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public Guid? ReversesEntryId { get; private set; }
    internal static ContributionEntry Record(Guid contributionId, decimal amount, string reference, string? note, string key, Guid actor, DateTimeOffset now) =>
        new() { ContributionId = contributionId, EntryType = ContributionEntryType.Record, Amount = amount, Reference = reference, Note = note, IdempotencyKey = key, RecordedByUserId = actor, CreatedAt = now };
    internal static ContributionEntry Reversal(ContributionEntry original, string reason, string key, Guid actor, DateTimeOffset now) =>
        new() { ContributionId = original.ContributionId, EntryType = ContributionEntryType.Reversal, Amount = original.Amount, Reference = original.Reference, Note = reason, IdempotencyKey = key, RecordedByUserId = actor, CreatedAt = now, ReversesEntryId = original.Id };
}
