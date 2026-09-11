using System.Data.Common;
using Dhanvi.Modules.Ledger.Domain;
namespace Dhanvi.Modules.Ledger.Application;

public sealed record BenefitSource(Guid MembershipId, decimal Amount);
// Created only by the source module adapter from persisted, finalized business records.
public sealed record LedgerSource(AccountingEventType EventType, Guid EventId, string SourceModule, Guid GroupId, Guid CycleId,
    Guid? WinnerMembershipId, Guid? SelectionResultId, Guid? AuctionResultId, decimal GroupValue, decimal WinnerPayout,
    decimal PlatformFee, IReadOnlyList<BenefitSource> Benefits, string TimeZone, DateTimeOffset OccurredAt, string Fingerprint);
public interface ILedgerSourceReader
{
    Task<LedgerSource> ReadLockedAsync(AccountingEventType type, Guid eventId, DbTransaction transaction, CancellationToken ct);
    Task LockGroupAsync(Guid groupId, DbTransaction transaction, CancellationToken ct);
    Task<IReadOnlyList<Guid>> MembershipsAsync(Guid userId, CancellationToken ct);
    Task<bool> GroupExistsAsync(Guid groupId, CancellationToken ct);
}
public sealed record PostingOutcome(string Status, Guid? JournalId, string? Reason, bool Replayed = false);
public interface ILedgerPostingService
{
    // Trusted application contract only; there is deliberately no HTTP posting endpoint.
    Task<PostingOutcome> PostAsync(AccountingEventType type, Guid eventId, Guid actor, string? correlationId,
        DbTransaction? transaction, CancellationToken ct);
    Task<PostingOutcome> ReverseAsync(Guid originalJournalId, Guid reversalEventId, string reason, Guid actor,
        string? correlationId, CancellationToken ct);
}
public sealed class LedgerPolicyOptions
{
    public FeeRecognitionPolicy FeeRecognition { get; set; } = FeeRecognitionPolicy.Deferred;
}
public sealed record LedgerFilter(DateOnly? From = null, DateOnly? To = null, AccountingEventType? EventType = null,
    string? Account = null, Guid? GroupId = null, Guid? CycleId = null, string? JournalNumber = null, int Page = 1, int PageSize = 20);
public sealed record AccountView(Guid Id, string Code, string Name, AccountType AccountType, NormalBalance NormalBalance, bool IsSystem, bool IsActive);
public sealed record BalanceView(string Code, string Name, AccountType AccountType, NormalBalance NormalBalance, string Currency, decimal DebitTotal, decimal CreditTotal, decimal Balance);
public sealed record TrialBalanceView(IReadOnlyList<BalanceView> Accounts, decimal TotalDebits, decimal TotalCredits, bool Balanced, int TotalJournals);
public sealed record JournalSummary(Guid Id, string JournalNumber, DateOnly BusinessDate, string BusinessTimeZone, AccountingEventType EventType,
    string Description, string SourceModule, string Status, DateTimeOffset PostedAt, decimal DebitTotal, decimal CreditTotal, Guid? GroupId);
public sealed record LineView(Guid Id, string AccountCode, string AccountName, decimal DebitAmount, decimal CreditAmount, string Currency,
    Guid? GroupId, Guid? CycleId, Guid? MembershipId, Guid? SelectionResultId, Guid? AuctionResultId, string ReferenceType, Guid ReferenceId, string Description);
public sealed record JournalView(JournalSummary Journal, Guid EventId, string PolicyVersion, FeeRecognitionPolicy FeePolicy,
    Guid PostedBy, string? CorrelationId, Guid? ReversesJournalEntryId, Guid? ReversedByJournalEntryId, string? ReversalReason, IReadOnlyList<LineView> Lines);
public sealed record LedgerPage<T>(IReadOnlyList<T> Items, int TotalCount, int Page, int PageSize);
public sealed record MemberLineView(Guid Id, string JournalNumber, DateOnly BusinessDate, DateTimeOffset PostedAt, string Description,
    string AccountName, decimal Increase, decimal Decrease, string Currency, Guid GroupId, Guid? CycleId, string ReferenceType, Guid ReferenceId);
public interface ILedgerQueries
{
    Task<IReadOnlyList<AccountView>> AccountsAsync(CancellationToken ct);
    Task<LedgerPage<JournalSummary>> JournalsAsync(LedgerFilter filter, CancellationToken ct);
    Task<JournalView> JournalAsync(Guid id, CancellationToken ct);
    Task<TrialBalanceView> TrialBalanceAsync(LedgerFilter filter, CancellationToken ct);
    Task<LedgerPage<MemberLineView>> MemberAsync(Guid userId, LedgerFilter filter, CancellationToken ct);
}
