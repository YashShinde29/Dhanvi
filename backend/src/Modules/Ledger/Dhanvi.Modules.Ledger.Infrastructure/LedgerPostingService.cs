using System.Data;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
namespace Dhanvi.Modules.Ledger.Infrastructure;

internal sealed class LedgerPostingService(ILedgerSourceReader sources, IConfiguration configuration, IOptions<LedgerPolicyOptions> policy, IDateTimeProvider clock) : ILedgerPostingService
{
    public Task<PostingOutcome> PostAsync(AccountingEventType type, Guid eventId, Guid actor, string? correlationId, DbTransaction? transaction, CancellationToken ct) =>
        Run(transaction, async (db, tx) =>
        {
            var source = await sources.ReadLockedAsync(type, eventId, tx, ct);
            var existing = await db.Journals.SingleOrDefaultAsync(j => j.EventType == source.EventType && j.EventId == source.EventId, ct);
            if (existing is not null)
            {
                BusinessRuleException.Require(existing.SourceFingerprint == source.Fingerprint, "LEDGER_EVENT_REUSED", "Source event differs from its posted journal.");
                return new("POSTED", existing.Id, null, true);
            }
            var accounts = await db.Accounts.Where(a => a.IsActive).ToDictionaryAsync(a => a.Code, ct);
            var poolAccount = accounts[ChartOfAccounts.GroupPool];
            var balance = await db.Lines.Where(l => l.AccountId == poolAccount.Id && l.GroupId == source.GroupId && l.CycleId == source.CycleId && l.Currency == "INR")
                .SumAsync(l => l.CreditAmount - l.DebitAmount, ct);
            var plan = LedgerPostingRules.Plan(source, balance, policy.Value.FeeRecognition);
            if (plan.DeferredReason is not null) return new("DEFERRED", null, plan.DeferredReason);
            var inputs = plan.Lines.Select(l => new JournalLineInput(accounts.TryGetValue(l.AccountCode, out var account) ? account.Id : throw new InvalidOperationException("Required ledger account is inactive or missing."),
                l.Debit, l.Credit, "INR", source.GroupId, source.CycleId, l.MembershipId, source.SelectionResultId, source.AuctionResultId,
                source.AuctionResultId.HasValue ? "AuctionResult" : "SelectionResult", source.AuctionResultId ?? source.EventId, "Finalized selection allocation")).ToArray();
            var journal = JournalEntry.Post(await Number(db, ct), source.EventType, source.EventId, source.SourceModule, source.Fingerprint,
                "Funded pool reclassified to finalized payout rights", source.TimeZone, source.OccurredAt, clock.UtcNow, actor, correlationId, policy.Value.FeeRecognition, inputs);
            await Persist(db, tx, journal, "LEDGER_JOURNAL_POSTED", ct);
            return new("POSTED", journal.Id, null);
        }, ct);

    public Task<PostingOutcome> ReverseAsync(Guid originalJournalId, Guid reversalEventId, string reason, Guid actor, string? correlationId, CancellationToken ct) =>
        Run(null, async (db, tx) =>
        {
            BusinessRuleException.Require(reversalEventId != Guid.Empty && !string.IsNullOrWhiteSpace(reason), "INVALID_REVERSAL", "A reversal event and reason are required.");
            var original = await db.Journals.Include(j => j.Lines).SingleOrDefaultAsync(j => j.Id == originalJournalId, ct) ?? throw new NotFoundException("Journal not found.");
            BusinessRuleException.Require(original.ReversesJournalEntryId is null, "REVERSAL_OF_REVERSAL_NOT_SUPPORTED", "A reversal cannot itself be reversed by this policy.");
            foreach (var group in original.Lines.Where(l => l.GroupId.HasValue).Select(l => l.GroupId!.Value).Distinct().Order()) await sources.LockGroupAsync(group, tx, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({originalJournalId.ToString()}, 0))", ct);
            var existing = await db.Journals.SingleOrDefaultAsync(j => j.ReversesJournalEntryId == originalJournalId, ct);
            if (existing is not null)
            {
                BusinessRuleException.Require(existing.EventId == reversalEventId && existing.ReversalReason == reason.Trim(), "JOURNAL_ALREADY_REVERSED", "This journal already has a different reversal.");
                return new("POSTED", existing.Id, null, true);
            }
            BusinessRuleException.Require(!await db.Journals.AnyAsync(j => j.EventType == AccountingEventType.AccountingReversal && j.EventId == reversalEventId, ct), "LEDGER_EVENT_REUSED", "Reversal event is already used.");
            var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{original.Id:N}\n{reason.Trim()}")));
            var journal = JournalEntry.Post(await Number(db, ct), AccountingEventType.AccountingReversal, reversalEventId, "Ledger", fingerprint,
                $"Reversal of {original.JournalNumber}", original.BusinessTimeZone, clock.UtcNow, clock.UtcNow, actor, correlationId, original.FeePolicy,
                original.ReversedLines(), original.Id, reason.Trim());
            await Persist(db, tx, journal, "LEDGER_JOURNAL_REVERSED", ct);
            return new("POSTED", journal.Id, null);
        }, ct);

    private async Task<PostingOutcome> Run(DbTransaction? external, Func<LedgerDbContext, DbTransaction, Task<PostingOutcome>> action, CancellationToken ct)
    {
        if (external is not null)
        {
            await using var enlisted = new LedgerDbContext(new DbContextOptionsBuilder<LedgerDbContext>().UseNpgsql(external.Connection!).Options);
            await enlisted.Database.UseTransactionAsync(external, ct);
            return await action(enlisted, external); // caller commits or rolls back business + accounting + audit together
        }
        await using var db = new LedgerDbContext(new DbContextOptionsBuilder<LedgerDbContext>().UseNpgsql(configuration.GetConnectionString("DefaultConnection")).Options);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var result = await action(db, tx.GetDbTransaction());
        await tx.CommitAsync(ct); return result;
    }
    private static async Task<string> Number(LedgerDbContext db, CancellationToken ct)
    {
        var sequence = await db.Database.SqlQueryRaw<long>("SELECT nextval('ledger.\"JournalNumberSequence\"') AS \"Value\"").SingleAsync(ct);
        return $"JRN-{sequence:D12}"; // global sequence; gaps after rolled-back postings are intentional
    }
    private static async Task Persist(LedgerDbContext db, DbTransaction tx, JournalEntry journal, string action, CancellationToken ct)
    {
        db.Journals.Add(journal); await db.SaveChangesAsync(ct);
        await using var audit = new AuditDbContext(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql(tx.Connection!).Options);
        await audit.Database.UseTransactionAsync(tx, ct);
        audit.AuditLogs.Add(AuditLog.Create(journal.PostedBy, action, nameof(JournalEntry), journal.Id.ToString(), journal.PostedAt, journal.CorrelationId));
        await audit.SaveChangesAsync(ct);
    }
}
