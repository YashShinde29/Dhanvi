using System.Data;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Ledger.Infrastructure;

internal sealed class LedgerQueries(LedgerDbContext db, ILedgerSourceReader sources) : ILedgerQueries
{
    public async Task<IReadOnlyList<AccountView>> AccountsAsync(CancellationToken ct) => await db.Accounts.AsNoTracking().OrderBy(a => a.Code)
        .Select(a => new AccountView(a.Id, a.Code, a.Name, a.AccountType, a.NormalBalance, a.IsSystem, a.IsActive)).ToArrayAsync(ct);
    public async Task<LedgerPage<JournalSummary>> JournalsAsync(LedgerFilter filter, CancellationToken ct)
    {
        await Validate(filter, ct); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var query = Filter(filter); var count = await query.CountAsync(ct);
        var rows = await Summaries(query.OrderByDescending(j => j.PostedAt).ThenByDescending(j => j.JournalNumber).Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)).ToArrayAsync(ct);
        await tx.CommitAsync(ct); return new(rows, count, filter.Page, filter.PageSize);
    }
    public async Task<JournalView> JournalAsync(Guid id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var journal = await db.Journals.AsNoTracking().SingleOrDefaultAsync(j => j.Id == id, ct) ?? throw new NotFoundException("Journal not found.");
        var summary = await Summaries(db.Journals.Where(j => j.Id == id)).SingleAsync(ct);
        var reverse = await db.Journals.Where(j => j.ReversesJournalEntryId == id).Select(j => (Guid?)j.Id).SingleOrDefaultAsync(ct);
        var lines = await (from l in db.Lines.AsNoTracking() join a in db.Accounts on l.AccountId equals a.Id where l.JournalEntryId == id
            orderby a.Code, l.MembershipId, l.Id select new LineView(l.Id, a.Code, a.Name, l.DebitAmount, l.CreditAmount, l.Currency,
                l.GroupId, l.CycleId, l.MembershipId, l.SelectionResultId, l.AuctionResultId, l.ReferenceType, l.ReferenceId, l.Description)).ToArrayAsync(ct);
        await tx.CommitAsync(ct);
        return new(summary, journal.EventId, journal.PolicyVersion, journal.FeePolicy, journal.PostedBy, journal.CorrelationId,
            journal.ReversesJournalEntryId, reverse, journal.ReversalReason, lines);
    }
    public async Task<TrialBalanceView> TrialBalanceAsync(LedgerFilter filter, CancellationToken ct)
    {
        await Validate(filter, ct); await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var journals = Filter(filter);
        var aggregates = await db.Lines.Where(l => journals.Any(j => j.Id == l.JournalEntryId)).GroupBy(l => l.AccountId)
            .Select(g => new { Id = g.Key, Debit = g.Sum(l => l.DebitAmount), Credit = g.Sum(l => l.CreditAmount) }).ToArrayAsync(ct);
        var accounts = await AccountsAsync(ct);
        var result = accounts.Select(a => { var sum = aggregates.SingleOrDefault(s => s.Id == a.Id); var debit = sum?.Debit ?? 0; var credit = sum?.Credit ?? 0;
            return new BalanceView(a.Code, a.Name, a.AccountType, a.NormalBalance, "INR", debit, credit, ChartOfAccounts.Balance(a.NormalBalance, debit, credit)); }).ToArray();
        var count = await journals.CountAsync(ct); await tx.CommitAsync(ct);
        var debits = result.Sum(a => a.DebitTotal); var credits = result.Sum(a => a.CreditTotal);
        return new(result, debits, credits, debits == credits, count);
    }
    public async Task<LedgerPage<MemberLineView>> MemberAsync(Guid userId, LedgerFilter filter, CancellationToken ct)
    {
        await Validate(filter, ct); var memberships = await sources.MembershipsAsync(userId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        // Filter at line level. Never return a shared journal's other members or platform lines.
        var query = from l in db.Lines.AsNoTracking() join j in Filter(filter) on l.JournalEntryId equals j.Id
            join a in db.Accounts on l.AccountId equals a.Id
            where l.MembershipId.HasValue && memberships.Contains(l.MembershipId.Value)
            orderby j.PostedAt descending, j.JournalNumber descending, l.Id
            select new MemberLineView(l.Id, j.JournalNumber, j.BusinessDate, j.PostedAt,
                j.ReversesJournalEntryId.HasValue ? "Accounting correction" : "Calculated entitlement recorded",
                a.Code == ChartOfAccounts.MemberPayout ? "Payout entitlement" : a.Code == ChartOfAccounts.MemberBenefit ? "Auction benefit entitlement" : "Financial activity",
                a.NormalBalance == NormalBalance.Debit ? l.DebitAmount : l.CreditAmount, a.NormalBalance == NormalBalance.Debit ? l.CreditAmount : l.DebitAmount,
                l.Currency, l.GroupId!.Value, l.CycleId, l.ReferenceType, l.ReferenceId);
        var count = await query.CountAsync(ct); var items = await query.Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize).ToArrayAsync(ct);
        await tx.CommitAsync(ct); return new(items, count, filter.Page, filter.PageSize);
    }
    private IQueryable<JournalEntry> Filter(LedgerFilter f)
    {
        var q = db.Journals.AsNoTracking();
        if (f.From.HasValue) q = q.Where(j => j.BusinessDate >= f.From.Value);
        if (f.To.HasValue) q = q.Where(j => j.BusinessDate <= f.To.Value);
        if (f.EventType.HasValue) q = q.Where(j => j.EventType == f.EventType.Value);
        if (!string.IsNullOrWhiteSpace(f.JournalNumber)) q = q.Where(j => j.JournalNumber == f.JournalNumber);
        if (f.GroupId.HasValue) q = q.Where(j => j.Lines.Any(l => l.GroupId == f.GroupId));
        if (f.CycleId.HasValue) q = q.Where(j => j.Lines.Any(l => l.CycleId == f.CycleId));
        if (!string.IsNullOrWhiteSpace(f.Account)) q = q.Where(j => j.Lines.Any(l => db.Accounts.Any(a => a.Id == l.AccountId && a.Code == f.Account)));
        return q;
    }
    private static IQueryable<JournalSummary> Summaries(IQueryable<JournalEntry> query) => query.Select(j => new JournalSummary(j.Id, j.JournalNumber,
        j.BusinessDate, j.BusinessTimeZone, j.EventType, j.Description, j.SourceModule, j.Status, j.PostedAt, j.DebitTotal, j.CreditTotal, j.Lines.Select(l => l.GroupId).FirstOrDefault()));
    private async Task Validate(LedgerFilter f, CancellationToken ct)
    {
        BusinessRuleException.Require(f.Page is >= 1 and <= 1000000 && f.PageSize is >= 1 and <= 100 && (!f.From.HasValue || !f.To.HasValue || f.From <= f.To) &&
            (!f.EventType.HasValue || Enum.IsDefined(f.EventType.Value)) && (f.JournalNumber?.Length ?? 0) <= 40 && (f.Account?.Length ?? 0) <= 20,
            "INVALID_LEDGER_FILTER", "Use a valid date range, page, event type and account filter.");
        if (f.GroupId.HasValue && !await sources.GroupExistsAsync(f.GroupId.Value, ct)) throw new NotFoundException("Group not found.");
    }
}
