using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Ledger.Domain;

public enum AccountingEventType
{
    ContributionRecorded, ContributionReversed, RandomSelectionCompleted, OrganizerReservedSelectionCompleted,
    AuctionSelectionCompleted, AuctionMemberBenefitCalculated, PlatformFeeCalculated, AccountingReversal,
    // Reserved vocabulary only: no Payment source adapter or posting handler exists in Prompt 7.
    PaymentReceived
}
public enum FeeRecognitionPolicy { Deferred, OnFundedSelection }
public sealed record JournalLineInput(Guid AccountId, decimal DebitAmount, decimal CreditAmount, string Currency,
    Guid? GroupId, Guid? CycleId, Guid? MembershipId, Guid? SelectionResultId, Guid? AuctionResultId,
    string ReferenceType, Guid ReferenceId, string Description);

public sealed class JournalEntry
{
    private readonly List<JournalLine> _lines = [];
    private JournalEntry() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string JournalNumber { get; private set; } = "";
    public AccountingEventType EventType { get; private set; }
    public Guid EventId { get; private set; }
    public string Description { get; private set; } = "";
    public DateOnly BusinessDate { get; private set; }
    public string BusinessTimeZone { get; private set; } = "";
    public DateTimeOffset PostedAt { get; private set; }
    public Guid PostedBy { get; private set; }
    public string Status { get; private set; } = "POSTED";
    public string? CorrelationId { get; private set; }
    public string IdempotencyKey { get; private set; } = "";
    public string SourceModule { get; private set; } = "";
    public string SourceFingerprint { get; private set; } = "";
    public string PolicyVersion { get; private set; } = "DHANVI_LEDGER_V1";
    public FeeRecognitionPolicy FeePolicy { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public Guid? ReversesJournalEntryId { get; private set; }
    public string? ReversalReason { get; private set; }
    public int LineCount { get; private set; }
    public decimal DebitTotal { get; private set; }
    public decimal CreditTotal { get; private set; }
    public IReadOnlyCollection<JournalLine> Lines => _lines.AsReadOnly();

    public static JournalEntry Post(string number, AccountingEventType eventType, Guid eventId, string sourceModule,
        string fingerprint, string description, string timeZone, DateTimeOffset occurredAt, DateTimeOffset postedAt,
        Guid actor, string? correlationId, FeeRecognitionPolicy feePolicy, IReadOnlyList<JournalLineInput> lines,
        Guid? reverses = null, string? reason = null)
    {
        BusinessRuleException.Require(Enum.IsDefined(eventType) && Enum.IsDefined(feePolicy) && eventId != Guid.Empty && actor != Guid.Empty &&
            !string.IsNullOrWhiteSpace(number) && number.Length <= 40 && !string.IsNullOrWhiteSpace(sourceModule) && sourceModule.Length <= 80 &&
            !string.IsNullOrWhiteSpace(description) && description.Length <= 1000 && fingerprint.Length == 64 && (correlationId?.Length ?? 0) <= 100,
            "INVALID_JOURNAL", "Journal identity, actor, source and description are required.");
        BusinessRuleException.Require(reverses.HasValue == (eventType == AccountingEventType.AccountingReversal) &&
            (!reverses.HasValue || reverses != Guid.Empty && !string.IsNullOrWhiteSpace(reason) && reason.Length <= 1000),
            "INVALID_REVERSAL", "A reversal requires its original journal and a reason.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var journal = new JournalEntry { JournalNumber = number, EventType = eventType, EventId = eventId, SourceModule = sourceModule,
            SourceFingerprint = fingerprint, Description = description, BusinessTimeZone = timeZone,
            BusinessDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(occurredAt, zone).DateTime), PostedAt = postedAt.ToUniversalTime(),
            CreatedAt = postedAt.ToUniversalTime(), PostedBy = actor, CorrelationId = correlationId, FeePolicy = feePolicy,
            IdempotencyKey = $"{eventType}:{eventId:N}", ReversesJournalEntryId = reverses, ReversalReason = reason };
        foreach (var line in lines) journal._lines.Add(JournalLine.Create(journal.Id, line, postedAt));
        journal.LineCount = journal.Lines.Count;
        journal.DebitTotal = journal.Lines.Sum(l => l.DebitAmount);
        journal.CreditTotal = journal.Lines.Sum(l => l.CreditAmount);
        BusinessRuleException.Require(journal.Lines.Count >= 2 && journal.Lines.Sum(l => l.DebitAmount) == journal.Lines.Sum(l => l.CreditAmount),
            "UNBALANCED_JOURNAL", "A journal must have at least two lines and equal total debits and credits.");
        return journal;
    }
    public JournalLineInput[] ReversedLines() => Lines.Select(l => new JournalLineInput(l.AccountId, l.CreditAmount, l.DebitAmount,
        l.Currency, l.GroupId, l.CycleId, l.MembershipId, l.SelectionResultId, l.AuctionResultId, l.ReferenceType, l.ReferenceId, l.Description)).ToArray();
}

public sealed class JournalLine
{
    private JournalLine() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid JournalEntryId { get; private set; }
    public Guid AccountId { get; private set; }
    public decimal DebitAmount { get; private set; }
    public decimal CreditAmount { get; private set; }
    public string Currency { get; private set; } = "INR";
    public Guid? GroupId { get; private set; }
    public Guid? CycleId { get; private set; }
    public Guid? MembershipId { get; private set; }
    public Guid? SelectionResultId { get; private set; }
    public Guid? AuctionResultId { get; private set; }
    public string ReferenceType { get; private set; } = "";
    public Guid ReferenceId { get; private set; }
    public string Description { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    internal static JournalLine Create(Guid journalId, JournalLineInput input, DateTimeOffset now)
    {
        BusinessRuleException.Require(input.AccountId != Guid.Empty && input.ReferenceId != Guid.Empty && !string.IsNullOrWhiteSpace(input.ReferenceType) &&
            input.ReferenceType.Length <= 80 && input.Description.Length <= 500 && input.GroupId != Guid.Empty && input.CycleId != Guid.Empty &&
            input.MembershipId != Guid.Empty && input.SelectionResultId != Guid.Empty && input.AuctionResultId != Guid.Empty,
            "INVALID_JOURNAL_REFERENCE", "Valid account and structured source references are required.");
        BusinessRuleException.Require(input.Currency == "INR", "UNSUPPORTED_LEDGER_CURRENCY", "Only INR is supported by this policy.");
        BusinessRuleException.Require(input.DebitAmount >= 0 && input.CreditAmount >= 0 && ((input.DebitAmount > 0) != (input.CreditAmount > 0)) &&
            input.DebitAmount <= 9999999999999999.99m && input.CreditAmount <= 9999999999999999.99m &&
            decimal.Round(input.DebitAmount, 2) == input.DebitAmount && decimal.Round(input.CreditAmount, 2) == input.CreditAmount,
            "INVALID_JOURNAL_AMOUNT", "Each INR line needs exactly one positive side, exact to paise.");
        return new() { JournalEntryId = journalId, AccountId = input.AccountId, DebitAmount = input.DebitAmount, CreditAmount = input.CreditAmount,
            Currency = input.Currency, GroupId = input.GroupId, CycleId = input.CycleId, MembershipId = input.MembershipId,
            SelectionResultId = input.SelectionResultId, AuctionResultId = input.AuctionResultId, ReferenceType = input.ReferenceType,
            ReferenceId = input.ReferenceId, Description = input.Description, CreatedAt = now.ToUniversalTime() };
    }
}
