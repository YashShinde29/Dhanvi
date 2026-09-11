using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
namespace Dhanvi.IntegrationTests.Api;

public sealed partial class CycleEndpointTests
{
    // Synthetic funded examples exist ONLY in disposable test databases. No application
    // endpoint or production payment adapter can create these settlement fixtures.
    private async Task<JournalEntry> Funding(Scenario s, Guid cycleId, decimal amount = 50000)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var journal = await FundingJournal(db, s, cycleId, amount); db.Journals.Add(journal); await db.SaveChangesAsync(); return journal;
    }
    private async Task<JournalEntry> FundingJournal(LedgerDbContext db, Scenario s, Guid cycleId, decimal amount)
    {
        var accounts = await db.Accounts.ToDictionaryAsync(a => a.Code); var eventId = Guid.NewGuid();
        var sequence = await db.Database.SqlQueryRaw<long>("SELECT nextval('ledger.\"JournalNumberSequence\"') AS \"Value\"").SingleAsync();
        JournalLineInput Line(string code, decimal debit, decimal credit) => new(accounts[code].Id, debit, credit, "INR", s.GroupId, cycleId, null, null, null, "TestOnlySettlement", eventId, "Synthetic future funding fixture");
        return JournalEntry.Post($"JRN-{sequence:D12}", AccountingEventType.PaymentReceived, eventId, "TestOnly", new('a', 64), "Synthetic funded example - tests only",
            "Asia/Kolkata", fixture.Clock.UtcNow, fixture.Clock.UtcNow, s.OwnerId, "ledger-test", FeeRecognitionPolicy.Deferred,
            [Line(ChartOfAccounts.CashClearing, amount, 0), Line(ChartOfAccounts.GroupPool, 0, amount)]);
    }
    private async Task<PostingOutcome> PostLedger(AccountingEventType type, Guid eventId, Guid actor)
    {
        using var scope = fixture.Factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ILedgerPostingService>().PostAsync(type, eventId, actor, "ledger-test", null, default);
    }
    private async Task<PostingOutcome> ReverseLedger(Guid original, Guid eventId, Guid actor, string reason = "Correct accounting classification")
    {
        using var scope = fixture.Factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ILedgerPostingService>().ReverseAsync(original, eventId, reason, actor, "ledger-reversal-test", default);
    }
    [Fact]
    public async Task LedgerSystemAccountsSeedIdempotentlyAndCodesAreUnique()
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var before = await db.Accounts.OrderBy(a => a.Code).Select(a => a.Id).ToArrayAsync();
        await scope.ServiceProvider.GetRequiredService<LedgerSeeder>().SeedAsync(default); await scope.ServiceProvider.GetRequiredService<LedgerSeeder>().SeedAsync(default);
        Assert.Equal(before, await db.Accounts.OrderBy(a => a.Code).Select(a => a.Id).ToArrayAsync()); Assert.Equal(8, before.Length);
        db.Accounts.Add(LedgerAccount.Create(ChartOfAccounts.SystemAccounts[0], fixture.Clock.UtcNow));
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync()); Assert.Equal("23505", Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
    [Fact]
    public async Task LedgerManualRecordingAndReversalNeverPostCash()
    {
        var s = await Seed(); using var owner = Owner(s); var cycle = (await Activate(owner, s))[0]; var row = (await Rows(owner, s, cycle.Id))[0];
        var recorded = await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "ledger-manual", null), "manual"));
        var outcome = await PostLedger(AccountingEventType.ContributionRecorded, recorded.Entry.Id, s.OwnerId);
        Assert.Equal("DEFERRED", outcome.Status); Assert.Equal("MANUAL_CONTRIBUTION_IS_NOT_PAYMENT", outcome.Reason);
        var reversed = await Result(Operation(owner, s, row, new ReverseContributionRequest(recorded.Entry.Id, "Operational correction"), "reverse", true));
        Assert.Equal("DEFERRED", (await PostLedger(AccountingEventType.ContributionReversed, reversed.Entry.Id, s.OwnerId)).Status);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Lines.AnyAsync(l => l.GroupId == s.GroupId));
        await Assert.ThrowsAsync<BusinessRuleException>(() => PostLedger(AccountingEventType.PaymentReceived, recorded.Entry.Id, s.OwnerId));
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task LedgerUnfundedSelectionPreservesBusinessResultWithoutPosting(bool reserved)
    {
        var (s, cycle) = await SelectionReady(reserved, reserved); using var owner = Owner(s); var selection = await Selection(Select(owner, s, cycle.Id));
        var outcome = await PostLedger(reserved ? AccountingEventType.OrganizerReservedSelectionCompleted : AccountingEventType.RandomSelectionCompleted, selection.Id, s.OwnerId);
        Assert.Equal("FUNDED_POOL_REQUIRED", outcome.Reason); Assert.Null(outcome.JournalId);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Lines.AnyAsync(l => l.GroupId == s.GroupId));
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task LedgerFundedSelectionPostsBalancedLiabilitiesAndAuditAtomically(bool reserved)
    {
        var (s, cycle) = await SelectionReady(reserved, reserved); var funding = await Funding(s, cycle.Id); using var owner = Owner(s);
        var selection = await Selection(Select(owner, s, cycle.Id));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var j = await db.Journals.Include(j => j.Lines).SingleAsync(j => j.EventId == selection.Id);
        Assert.Equal(50000, j.DebitTotal); Assert.Equal(j.DebitTotal, j.CreditTotal); Assert.Equal(2, j.LineCount); Assert.Equal(TimeSpan.Zero, j.PostedAt.Offset);
        Assert.All(j.Lines, l => { Assert.Equal(cycle.Id, l.CycleId); Assert.Equal(s.GroupId, l.GroupId); Assert.Equal(selection.Id, l.SelectionResultId); });
        var pool = await db.Accounts.SingleAsync(a => a.Code == ChartOfAccounts.GroupPool);
        Assert.Equal(0, await db.Lines.Where(l => l.AccountId == pool.Id && l.CycleId == cycle.Id).SumAsync(l => l.CreditAmount - l.DebitAmount));
        Assert.True(await scope.ServiceProvider.GetRequiredService<AuditDbContext>().AuditLogs.AnyAsync(a => a.EntityId == j.Id.ToString() && a.Action == "LEDGER_JOURNAL_POSTED"));
        Assert.NotEqual(funding.JournalNumber, j.JournalNumber);
        using var response = await owner.GetAsync($"/api/v1/admin/ledger/journals/{j.Id}");
        if (!reserved) Assert.Equal(HttpStatusCode.OK, response.StatusCode); else Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Fact]
    public async Task LedgerUnfundedAuctionKeepsCalculatedFeeAndBenefitsUnsettled()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var member = Client(s.MemberIds[0]); await BidResponse(PlaceBid(member, s, cycle.Id));
        var closed = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")); Assert.Equal("CALCULATED_PENDING_SETTLEMENT", closed.Result!.AllocationStatus);
        Assert.Equal(750, closed.Result.PlatformFee); Assert.Equal(14250, closed.Result.MemberBenefitPool);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Lines.AnyAsync(l => l.GroupId == s.GroupId));
        Assert.Equal("FUNDED_POOL_REQUIRED", (await PostLedger(AccountingEventType.PlatformFeeCalculated, closed.Result.Id, s.OwnerId)).Reason);
    }
    [Fact]
    public async Task LedgerFundedAuctionPostsMemberDimensionsAndDeferredFeeAndProtectsPrivacy()
    {
        var (s, cycle) = await AuctionReady(); await Funding(s, cycle.Id); using var owner = Owner(s); using var member = Client(s.MemberIds[0]); await BidResponse(PlaceBid(member, s, cycle.Id));
        var closed = await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close"));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var j = await db.Journals.Include(j => j.Lines).SingleAsync(j => j.EventType == AccountingEventType.AuctionSelectionCompleted && j.Lines.Any(l => l.CycleId == cycle.Id));
        var accounts = await db.Accounts.ToDictionaryAsync(a => a.Code);
        Assert.Equal(22, j.LineCount); Assert.Equal(750, j.Lines.Single(l => l.AccountId == accounts[ChartOfAccounts.DeferredPlatformFee].Id).CreditAmount);
        Assert.DoesNotContain(j.Lines, l => l.AccountId == accounts[ChartOfAccounts.ServiceFeeRevenue].Id || l.AccountId == accounts[ChartOfAccounts.CashClearing].Id || l.AccountId == accounts[ChartOfAccounts.PlatformFeeReceivable].Id);
        Assert.Equal(19, j.Lines.Count(l => l.AccountId == accounts[ChartOfAccounts.MemberBenefit].Id));
        Assert.All(j.Lines, l => Assert.Equal(closed.Result!.Id, l.AuctionResultId));
        foreach (var alias in new[] { AccountingEventType.PlatformFeeCalculated, AccountingEventType.AuctionMemberBenefitCalculated })
        { var replay = await PostLedger(alias, closed.Result!.Id, s.OwnerId); Assert.True(replay.Replayed); Assert.Equal(j.Id, replay.JournalId); }
        using var other = Client(s.MemberIds[1]); var winnerHistory = await member.GetFromJsonAsync<LedgerPage<MemberLineView>>("/api/v1/me/ledger", Json);
        var otherHistory = await other.GetFromJsonAsync<LedgerPage<MemberLineView>>("/api/v1/me/ledger", Json);
        Assert.Single(winnerHistory!.Items); Assert.Equal(35000, winnerHistory.Items[0].Increase);
        Assert.Single(otherHistory!.Items); Assert.Equal(750, otherHistory.Items[0].Increase); Assert.NotEqual(winnerHistory.Items[0].Id, otherHistory.Items[0].Id);
        using var denied = await member.GetAsync($"/api/v1/admin/ledger/journals/{j.Id}"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var details = await owner.GetFromJsonAsync<JournalView>($"/api/v1/admin/ledger/journals/{j.Id}", Json); Assert.Equal(22, details!.Lines.Count);
    }
    [Fact]
    public async Task LedgerConcurrentDuplicatePostingAndRetryCreateOneJournal()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); var selected = await Selection(Select(owner, s, cycle.Id)); await Funding(s, cycle.Id);
        var results = await Task.WhenAll(PostLedger(AccountingEventType.RandomSelectionCompleted, selected.Id, s.OwnerId), PostLedger(AccountingEventType.RandomSelectionCompleted, selected.Id, s.OwnerId));
        Assert.Equal(results[0].JournalId, results[1].JournalId); Assert.Single(results, r => !r.Replayed);
        Assert.Equal(results[0].JournalId, (await PostLedger(AccountingEventType.RandomSelectionCompleted, selected.Id, s.OwnerId)).JournalId);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Journals.CountAsync(j => j.EventId == selected.Id));
    }
    [Fact]
    public async Task LedgerReversalIsNewExactHistoryAndConcurrentDoubleReversalIsSafe()
    {
        var (s, cycle) = await SelectionReady(); await Funding(s, cycle.Id); using var owner = Owner(s); var selected = await Selection(Select(owner, s, cycle.Id));
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var original = await db.Journals.AsNoTracking().Include(j => j.Lines).SingleAsync(j => j.EventId == selected.Id); var eventId = Guid.NewGuid();
        var results = await Task.WhenAll(ReverseLedger(original.Id, eventId, s.OwnerId), ReverseLedger(original.Id, eventId, s.OwnerId)); Assert.Equal(results[0].JournalId, results[1].JournalId);
        var reversed = await db.Journals.AsNoTracking().Include(j => j.Lines).SingleAsync(j => j.Id == results[0].JournalId);
        Assert.Equal(original.Id, reversed.ReversesJournalEntryId); Assert.Null(original.ReversesJournalEntryId); Assert.Equal(original.Lines.Count, reversed.Lines.Count);
        foreach (var line in original.Lines) { var reverse = reversed.Lines.Single(l => l.AccountId == line.AccountId); Assert.Equal(line.DebitAmount, reverse.CreditAmount); Assert.Equal(line.CreditAmount, reverse.DebitAmount); Assert.Equal(line.ReferenceId, reverse.ReferenceId); }
        await Assert.ThrowsAsync<BusinessRuleException>(() => ReverseLedger(original.Id, Guid.NewGuid(), s.OwnerId));
        var details = await owner.GetFromJsonAsync<JournalView>($"/api/v1/admin/ledger/journals/{original.Id}", Json); Assert.Equal(reversed.Id, details!.ReversedByJournalEntryId);
        Assert.True(await scope.ServiceProvider.GetRequiredService<AuditDbContext>().AuditLogs.AnyAsync(a => a.EntityId == reversed.Id.ToString() && a.Action == "LEDGER_JOURNAL_REVERSED"));
    }
    [Fact]
    public async Task LedgerTrialBalanceAccountBalanceAndGroupFiltersUsePostedLines()
    {
        var (s, cycle) = await SelectionReady(); await Funding(s, cycle.Id); using var owner = Owner(s); await Selection(Select(owner, s, cycle.Id));
        var unrelated = await Seed(); var trial = await owner.GetFromJsonAsync<TrialBalanceView>($"/api/v1/admin/ledger/groups/{s.GroupId}/balances", Json);
        Assert.True(trial!.Balanced); Assert.Equal(100000, trial.TotalDebits); Assert.Equal(100000, trial.TotalCredits);
        Assert.Equal(50000, trial.Accounts.Single(a => a.Code == ChartOfAccounts.CashClearing).Balance); Assert.Equal(0, trial.Accounts.Single(a => a.Code == ChartOfAccounts.GroupPool).Balance);
        Assert.Equal(50000, trial.Accounts.Single(a => a.Code == ChartOfAccounts.MemberPayout).Balance);
        var account = await owner.GetFromJsonAsync<BalanceView>($"/api/v1/admin/ledger/accounts/2100/balance?groupId={s.GroupId}", Json); Assert.Equal(50000, account!.Balance);
        var list = await owner.GetFromJsonAsync<LedgerPage<JournalSummary>>($"/api/v1/admin/ledger/groups/{s.GroupId}?pageSize=1", Json); Assert.Equal(2, list!.TotalCount); Assert.Single(list.Items);
        var empty = await owner.GetFromJsonAsync<LedgerPage<JournalSummary>>($"/api/v1/admin/ledger/groups/{unrelated.GroupId}", Json); Assert.Empty(empty!.Items);
        using var member = Client(unrelated.MemberIds[0]); Assert.Empty((await member.GetFromJsonAsync<LedgerPage<MemberLineView>>("/api/v1/me/ledger", Json))!.Items);
        using var invalid = await owner.GetAsync("/api/v1/admin/ledger/journals?pageSize=101"); Assert.Equal(HttpStatusCode.Conflict, invalid.StatusCode);
    }
    [Theory] [InlineData("journal-update")] [InlineData("journal-delete")] [InlineData("line-update")] [InlineData("line-delete")]
    public async Task LedgerDatabaseRejectsPostedHistoryMutations(string operation)
    {
        var s = await Seed(); using var owner = Owner(s); var cycle = (await Activate(owner, s))[0]; var j = await Funding(s, cycle.Id);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        Task<int> Mutation() => operation switch {
            "journal-update" => db.Journals.Where(x => x.Id == j.Id).ExecuteUpdateAsync(x => x.SetProperty(journal => journal.Description, "tampered")),
            "journal-delete" => db.Journals.Where(x => x.Id == j.Id).ExecuteDeleteAsync(),
            "line-update" => db.Lines.Where(x => x.JournalEntryId == j.Id).ExecuteUpdateAsync(x => x.SetProperty(line => line.Description, "tampered")),
            _ => db.Lines.Where(x => x.JournalEntryId == j.Id).ExecuteDeleteAsync() };
        var error = await Assert.ThrowsAsync<PostgresException>(Mutation); Assert.Equal("23514", error.SqlState);
    }
    [Fact]
    public async Task LedgerDatabaseRejectsAdditionalBalancedLinesInAnAlreadyPostedJournal()
    {
        var s = await Seed(); using var owner = Owner(s); var cycle = (await Activate(owner, s))[0]; var original = await Funding(s, cycle.Id);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var extra = await FundingJournal(db, s, cycle.Id, 100); db.Lines.AddRange(extra.Lines);
        foreach (var line in extra.Lines) db.Entry(line).Property(l => l.JournalEntryId).CurrentValue = original.Id;
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
    [Fact]
    public async Task LedgerDatabaseRejectsIncompleteJournalAndRollsBack()
    {
        var s = await Seed(); using var owner = Owner(s); var cycle = (await Activate(owner, s))[0];
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var j = await FundingJournal(db, s, cycle.Id, 100);
        db.Journals.Add(j); db.Entry(j).Property(x => x.LineCount).CurrentValue = 3;
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync()); db.ChangeTracker.Clear();
        Assert.False(await db.Journals.AnyAsync(x => x.Id == j.Id)); Assert.False(await db.Lines.AnyAsync(x => x.JournalEntryId == j.Id));
    }
    [Theory] [InlineData(true)] [InlineData(false)]
    public async Task LedgerDatabaseEnforcesUniqueJournalNumbersAndBusinessEvents(bool number)
    {
        var s = await Seed(); using var owner = Owner(s); var cycle = (await Activate(owner, s))[0]; var original = await Funding(s, cycle.Id);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var duplicate = await FundingJournal(db, s, cycle.Id, 100); db.Journals.Add(duplicate);
        if (number) db.Entry(duplicate).Property(j => j.JournalNumber).CurrentValue = original.JournalNumber;
        else db.Entry(duplicate).Property(j => j.EventId).CurrentValue = original.EventId;
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync()); Assert.Equal("23505", Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
    [Fact]
    public async Task LedgerFailureRollsBackSourceSelectionAndJournalTogether()
    {
        var (s, cycle) = await SelectionReady(); await Funding(s, cycle.Id); using var owner = Owner(s);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var groups = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var function = "fail_ledger_" + Guid.NewGuid().ToString("N");
        var sql = $"CREATE FUNCTION ledger.{function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"EventType\" = 'RandomSelectionCompleted' THEN RAISE EXCEPTION 'Injected ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER {function} BEFORE INSERT ON ledger.\"JournalEntries\" FOR EACH ROW EXECUTE FUNCTION ledger.{function}();";
        await db.Database.ExecuteSqlRawAsync(sql);
        try
        {
            using var failed = await Select(owner, s, cycle.Id); Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
            Assert.False(await groups.SelectionResults.AnyAsync(r => r.CycleId == cycle.Id)); Assert.False(await groups.Memberships.AnyAsync(m => m.GroupId == s.GroupId && m.HasBeenSelectedForPayout));
            Assert.Equal(CycleStatus.ReadyForSelection, (await groups.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
            Assert.Equal(1, await db.Journals.CountAsync(j => j.Lines.Any(l => l.GroupId == s.GroupId)));
        }
        finally { var cleanup = $"DROP TRIGGER {function} ON ledger.\"JournalEntries\"; DROP FUNCTION ledger.{function}();"; await db.Database.ExecuteSqlRawAsync(cleanup); }
    }
    [Fact]
    public async Task LedgerNoArbitraryPostingEndpointsAreExposed()
    {
        var s = await Seed(); using var owner = Owner(s);
        using var response = await owner.PostAsJsonAsync("/api/v1/admin/ledger/journals", new { debit = 50000 }); Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        using var member = Client(s.MemberIds[0]); using var denied = await member.GetAsync("/api/v1/admin/ledger/accounts"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }
}
