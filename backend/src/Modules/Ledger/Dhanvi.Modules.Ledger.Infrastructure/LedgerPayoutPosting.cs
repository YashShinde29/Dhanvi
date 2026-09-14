using System.Data.Common;
using System.Security.Cryptography;
using System.Text.Json;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Ledger.Infrastructure;
internal sealed partial class LedgerPostingService
{
    private async Task<(SettledPayoutSource Source, Dictionary<string, LedgerAccount> Accounts)> PayoutFunds(LedgerDbContext db, Guid id, DbTransaction tx, CancellationToken ct)
    {
        var s = await payouts.Single().ReadAsync(id, tx, ct);
        await sources.LockGroupAsync(s.GroupId, tx, ct);
        var accounts = await db.Accounts.Where(a => a.IsActive).ToDictionaryAsync(a => a.Code, ct);
        var code = s.Benefit ? ChartOfAccounts.MemberBenefit : ChartOfAccounts.MemberPayout;
        var allocated = await db.Lines.AnyAsync(l => l.JournalEntryId == s.AllocationJournalId && l.AccountId == accounts[code].Id && l.GroupId == s.GroupId &&
            l.CycleId == s.CycleId && l.MembershipId == s.MembershipId && l.SelectionResultId == s.SelectionResultId && l.CreditAmount == s.Amount, ct);
        var reversed = await db.Journals.AnyAsync(j => j.ReversesJournalEntryId == s.AllocationJournalId, ct);
        var balance = await db.Lines.Where(l => l.AccountId == accounts[code].Id && l.GroupId == s.GroupId && l.CycleId == s.CycleId && l.MembershipId == s.MembershipId)
            .SumAsync(l => l.CreditAmount - l.DebitAmount, ct);
        BusinessRuleException.Require(allocated && !reversed && balance >= s.Amount, "INSUFFICIENT_FUNDED_POOL", "The funded selection liability is insufficient or reversed.");
        return (s, accounts);
    }
    public async Task EnsurePayoutFundedAsync(Guid payoutId, DbTransaction transaction, CancellationToken ct) =>
        _ = await Run(transaction, async (db, tx) => { await PayoutFunds(db, payoutId, tx, ct); return new PostingOutcome("FUNDED", null, null); }, ct);
    public async Task<Guid> SettlePayoutAsync(Guid payoutId, DbTransaction transaction, CancellationToken ct)
    {
        var result = await Run(transaction, async (db, tx) => {
            var existing = await db.Journals.SingleOrDefaultAsync(j => j.EventType == AccountingEventType.PayoutSettled && j.EventId == payoutId, ct);
            if (existing is not null) return new PostingOutcome("POSTED", existing.Id, null, true);
            var (s, accounts) = await PayoutFunds(db, payoutId, tx, ct);
            BusinessRuleException.Require(s.MatchedSuccess, "PAYOUT_RECONCILIATION_REQUIRED", "Authoritative matched provider success is required.");
            JournalLineInput Line(string code, decimal debit, decimal credit) => new(accounts[code].Id, debit, credit, "INR", s.GroupId, s.CycleId, s.MembershipId,
                s.SelectionResultId, s.AuctionResultId, "PayoutObligation", s.Id, "Reconciled fake payout settlement");
            var journal = JournalEntry.Post(await Number(db, ct), AccountingEventType.PayoutSettled, s.Id, "Payouts",
                Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(s))), "Reconciled test payout", s.TimeZone, s.RequestedAt,
                clock.UtcNow, s.Actor, null, FeeRecognitionPolicy.Deferred,
                [Line(s.Benefit ? ChartOfAccounts.MemberBenefit : ChartOfAccounts.MemberPayout, s.Amount, 0), Line(ChartOfAccounts.PayoutGatewayClearing, 0, s.Amount)]);
            await Persist(db, tx, journal, "LEDGER_JOURNAL_POSTED", ct); return new PostingOutcome("POSTED", journal.Id, null);
        }, ct);
        return result.JournalId!.Value;
    }
}
