using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
namespace Dhanvi.IntegrationTests.Api;
public sealed partial class CycleEndpointTests
{
    private async Task<PayoutView[]> Prepare(Scenario s, Guid cycle)
    {
        using var admin = Client(s.OwnerId, "ADMIN"); using var response = await admin.PostAsJsonAsync($"/api/v1/admin/cycles/{cycle}/prepare-settlement", new { });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<PayoutView[]>(Json))!;
    }
    private async Task<(Scenario S, Guid Cycle, PayoutView Payout)> PayoutReady(bool reserved = false, int count = 20)
    {
        var (s, c) = await SelectionReady(reserved, reserved, count: count); using var owner = Owner(s); await Selection(Select(owner, s, c.Id)); await Funding(s, c.Id);
        var p = Assert.Single(await Prepare(s, c.Id)); return (s, c.Id, p);
    }
    [Fact]
    public async Task TwoMemberOrganizerFirstPayoutSettlesAndOpensFinalRandomCycle()
    {
        var (s, cycle, payout) = await PayoutReady(reserved: true, count: 2);
        Assert.Equal(s.OwnerId, await PayoutUser(payout.Id));
        Assert.Equal(50000m, payout.Amount);
        await AddPayoutAccount(s.OwnerId);
        using var scope = fixture.Factory.Services.CreateScope();
        var identities = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var administrator = NewUser(fixture.Clock.UtcNow);
        identities.Users.Add(administrator); await identities.SaveChangesAsync();
        await PayoutAction(payout.Id, administrator.Id, "approve");
        var settled = await PayoutAction(payout.Id, administrator.Id, "execute");
        Assert.Equal(PayoutStatus.Succeeded, settled.Status);
        var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var cycles = await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId).OrderBy(c => c.CycleNumber).ToArrayAsync();
        Assert.Equal(2, cycles.Length);
        Assert.Equal(CycleStatus.Completed, cycles[0].Status);
        Assert.Equal(SelectionMethod.OrganizerReserved, cycles[0].SelectionMethod);
        Assert.Equal(SelectionMethod.Random, cycles[1].SelectionMethod);
        Assert.Equal(CycleStatus.CollectingContributions, cycles[1].Status);
        Assert.Equal(4, await db.Contributions.CountAsync(c => c.GroupId == s.GroupId));
    }
    private async Task<Guid> PayoutUser(Guid id)
    { using var scope = fixture.Factory.Services.CreateScope(); return (await scope.ServiceProvider.GetRequiredService<PayoutsDbContext>().Obligations.SingleAsync(p => p.Id == id)).UserId!.Value; }
    private async Task<BeneficiaryView> AddPayoutAccount(Guid user, string suffix = "1234")
    {
        using var scope = fixture.Factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<IPayoutService>().AddAccountAsync(user, new("Test Member", "00000" + suffix, "00000" + suffix, "TEST0123456", "Fake bank", ""), default);
    }
    private async Task<PayoutView> PayoutAction(Guid id, Guid actor, string action, string? key = null)
    {
        using var admin = Client(actor, "ADMIN"); using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/admin/payouts/{id}/{action}") { Content = JsonContent.Create(new { amount = 1, recipient = Guid.NewGuid(), status = "SUCCEEDED" }) };
        request.Headers.Add("Idempotency-Key", key ?? Guid.NewGuid().ToString()); using var response = await admin.SendAsync(request);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<PayoutView>(Json))!;
    }
    private async Task SetFakeOutcome(Guid id, GatewayPayoutStatus status, string? mismatch = null)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        var remote = await db.FakePayouts.SingleAsync(x => x.Reference == id.ToString("N")); remote.Status = status; remote.Revision++;
        if (mismatch == "amount") remote.Amount = 1; if (mismatch == "currency") remote.Currency = "USD"; if (mismatch == "destination") remote.FundAccountId = "fake_fa_wrong"; if (mismatch == "reference") remote.Reference = "wrong";
        await db.SaveChangesAsync();
    }
    private async Task ReservePending(Guid id, Guid actor)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        var p = await db.Obligations.SingleAsync(p => p.Id == id); var b = await db.Beneficiaries.SingleAsync(b => b.Id == p.BeneficiaryId);
        p.Begin(false, fixture.Clock.UtcNow); await db.SaveChangesAsync();
        var a = PayoutAttempt.Create(p, b, 1, "pending-test", actor, fixture.Clock.UtcNow); db.Attempts.Add(a); await db.SaveChangesAsync();
        db.FakePayouts.Add(new() { Id = a.ProviderPayoutId, IdempotencyKey = a.IdempotencyKey, FundAccountId = a.ProviderFundAccountId, Amount = a.Amount, Currency = "INR", Reference = id.ToString("N"), Status = GatewayPayoutStatus.Pending }); await db.SaveChangesAsync();
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task PayoutRandomAndOrganizerPreparationIsFundedAndIdempotent(bool reserved)
    {
        var (s, cycle, p) = await PayoutReady(reserved); var results = await Task.WhenAll(Prepare(s, cycle), Prepare(s, cycle));
        Assert.All(results, r => Assert.Equal(p.Id, Assert.Single(r).Id)); Assert.Equal(50000, p.Amount); Assert.Equal(PayoutType.WinnerPayout, p.PayoutType); Assert.Null(p.SettledAt);
        using var scope = fixture.Factory.Services.CreateScope(); var ledger = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var journal = await ledger.Journals.SingleAsync(j => j.Id == p.AllocationJournalId); Assert.Equal(50000, journal.DebitTotal); Assert.Equal(journal.DebitTotal, journal.CreditTotal);
        if (reserved) Assert.Equal(s.OwnerId, await PayoutUser(p.Id));
    }
    [Fact] public async Task PayoutUnfundedPreparationIsRejected()
    {
        var (s, cycle) = await SelectionReady(); using var owner = Owner(s); await Selection(Select(owner, s, cycle.Id));
        using var response = await owner.PostAsJsonAsync($"/api/v1/admin/cycles/{cycle.Id}/prepare-settlement", new { });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("INSUFFICIENT_FUNDED_POOL", await response.Content.ReadAsStringAsync());
        using var scope = fixture.Factory.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<PayoutsDbContext>().Obligations.AnyAsync(p => p.CycleId == cycle.Id));
    }
    [Fact] public async Task PayoutSuccessIsConcurrentIdempotentAndOpensNextCycle()
    {
        var (s, cycle, p) = await PayoutReady(); var user = await PayoutUser(p.Id); await AddPayoutAccount(user); await PayoutAction(p.Id, s.OwnerId, "approve");
        var result = await Task.WhenAll(PayoutAction(p.Id, s.OwnerId, "execute", "same"), PayoutAction(p.Id, s.OwnerId, "execute", "other"));
        Assert.Contains(result, r => r.Status == PayoutStatus.Succeeded); var success = await PayoutAction(p.Id, s.OwnerId, "reconcile"); Assert.Equal(50000, success.Amount);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>(); var groups = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        Assert.Equal(1, await db.Attempts.CountAsync(a => a.PayoutObligationId == p.Id)); Assert.Equal(1, await db.FakePayouts.CountAsync(a => a.Reference == p.Id.ToString("N")));
        Assert.Equal(CycleStatus.Completed, (await groups.MonthlyCycles.SingleAsync(c => c.Id == cycle)).Status);
        var next = await groups.MonthlyCycles.SingleAsync(c => c.GroupId == s.GroupId && c.CycleNumber == 2); Assert.Equal(CycleStatus.CollectingContributions, next.Status);
        Assert.Equal(2, (await groups.Groups.SingleAsync(g => g.Id == s.GroupId)).CurrentCycleNumber);
        var winner = await groups.Memberships.SingleAsync(m => m.GroupId == s.GroupId && m.UserId == user); Assert.True(winner.HasBeenSelectedForPayout);
        Assert.True(await groups.Contributions.AnyAsync(c => c.CycleId == next.Id && c.MembershipId == winner.Id && c.ExpectedAmount == 2500));
        var ledger = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var journal = Assert.Single(await ledger.Journals.Include(j => j.Lines).Where(j => j.EventType == AccountingEventType.PayoutSettled && j.EventId == p.Id).ToArrayAsync());
        Assert.Equal(50000, journal.DebitTotal); Assert.Equal(journal.DebitTotal, journal.CreditTotal);
        var accounts = await ledger.Accounts.ToDictionaryAsync(a => a.Code); Assert.Equal(50000, journal.Lines.Single(l => l.AccountId == accounts[ChartOfAccounts.MemberPayout].Id).DebitAmount);
        Assert.Equal(50000, journal.Lines.Single(l => l.AccountId == accounts[ChartOfAccounts.PayoutGatewayClearing].Id).CreditAmount);
    }
    [Fact] public async Task PayoutPendingFailureAndRetryPreserveHistoryAndLiability()
    {
        var (s, cycle, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await ReservePending(p.Id, s.OwnerId);
        Assert.Equal(PayoutStatus.ProviderPending, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
        await SetFakeOutcome(p.Id, GatewayPayoutStatus.Failed); Assert.Equal(PayoutStatus.Failed, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Journals.AnyAsync(j => j.EventType == AccountingEventType.PayoutSettled && j.EventId == p.Id));
            Assert.Equal(CycleStatus.SelectionCompleted, (await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle)).Status);
        }
        await Task.WhenAll(PayoutAction(p.Id, s.OwnerId, "retry", "retry"), PayoutAction(p.Id, s.OwnerId, "retry", "retry"));
        using var admin = Client(s.OwnerId, "ADMIN"); var detail = (await admin.GetFromJsonAsync<PayoutDetails>($"/api/v1/admin/payouts/{p.Id}", Json))!;
        Assert.Equal(PayoutStatus.Succeeded, detail.Payout.Status); Assert.Equal(2, detail.Attempts.Count); Assert.Equal("FAILED", detail.Attempts[0].Status); Assert.Equal("SUCCEEDED", detail.Attempts[1].Status);
        Assert.NotEqual(detail.Attempts[0].ProviderPayoutId, detail.Attempts[1].ProviderPayoutId);
    }
    [Theory] [InlineData("amount")] [InlineData("currency")] [InlineData("destination")] [InlineData("reference")]
    public async Task PayoutReconciliationMismatchNeverSettles(string mismatch)
    {
        var (s, _, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await ReservePending(p.Id, s.OwnerId);
        await SetFakeOutcome(p.Id, GatewayPayoutStatus.Success, mismatch); Assert.Equal(PayoutStatus.ReconciliationRequired, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
        Assert.Equal(PayoutStatus.ReconciliationRequired, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
        using var scope = fixture.Factory.Services.CreateScope(); Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Journals.AnyAsync(j => j.EventType == AccountingEventType.PayoutSettled && j.EventId == p.Id));
    }
    [Fact] public async Task PayoutAuthorizationBeneficiaryMaskAndSnapshotAreEnforced()
    {
        var (s, _, p) = await PayoutReady(); var user = await PayoutUser(p.Id); var b = await AddPayoutAccount(user);
        using var member = Client(user); using var denied = await member.PostAsJsonAsync($"/api/v1/admin/payouts/{p.Id}/approve", new { }); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var outsider = Client(s.OwnerId); using var privateDetail = await outsider.GetAsync($"/api/v1/me/payouts/{p.Id}"); Assert.Equal(HttpStatusCode.Forbidden, privateDetail.StatusCode);
        var mine = (await member.GetFromJsonAsync<PayoutPage>("/api/v1/me/payouts", Json))!; Assert.Contains(mine.Items, x => x.Id == p.Id);
        var approved = await PayoutAction(p.Id, s.OwnerId, "approve"); Assert.Equal("****1234", approved.MaskedAccountNumber);
        await AddPayoutAccount(user, "5678"); var result = await PayoutAction(p.Id, s.OwnerId, "execute"); Assert.Equal("****1234", result.MaskedAccountNumber);
        var payload = await member.GetStringAsync($"/api/v1/me/payouts/{p.Id}"); Assert.DoesNotContain("000001234", payload); Assert.DoesNotContain("000005678", payload); Assert.DoesNotContain("providerFundAccountId", payload);
        Assert.Equal(BeneficiaryStatus.FormatValidated, b.Status);
    }
    [Fact] public async Task PayoutAccountRequiresPasswordReverificationAndNeverReturnsFullNumber()
    {
        var (s, _, p) = await PayoutReady(); var user = await PayoutUser(p.Id);
        using (var scope = fixture.Factory.Services.CreateScope()) { var identities = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); var u = await identities.Users.SingleAsync(u => u.Id == user); u.SetPasswordHash(scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>().HashPassword(u, "TestPassword@123"), fixture.Clock.UtcNow); await identities.SaveChangesAsync(); }
        using var member = Client(user); var r = new PayoutAccountRequest("Test Member", "000001234", "000001234", "TEST0123456", "Fake bank", "wrong");
        using var denied = await member.PostAsJsonAsync("/api/v1/users/me/payout-account", r); Assert.False(denied.IsSuccessStatusCode);
        using var saved = await member.PostAsJsonAsync("/api/v1/users/me/payout-account", r with { Password = "TestPassword@123" }); Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
        var payload = await saved.Content.ReadAsStringAsync(); Assert.Contains("****1234", payload); Assert.DoesNotContain("000001234", payload); Assert.DoesNotContain("TestPassword", payload);
    }
    [Fact] public async Task PayoutSuspendedGroupCannotExecuteAndMissingBeneficiaryCannotApprove()
    {
        var (s, _, p) = await PayoutReady(); using var admin = Client(s.OwnerId, "ADMIN"); using var missing = await admin.PostAsJsonAsync($"/api/v1/admin/payouts/{p.Id}/approve", new { }); Assert.Contains("PAYOUT_BENEFICIARY_REQUIRED", await missing.Content.ReadAsStringAsync());
        await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve");
        using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); (await db.Groups.SingleAsync(g => g.Id == s.GroupId)).Stop(false, "Test hold", fixture.Clock.UtcNow); await db.SaveChangesAsync(); }
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/admin/payouts/{p.Id}/execute") { Content = JsonContent.Create(new { }) }; request.Headers.Add("Idempotency-Key", "suspended");
        using var rejected = await admin.SendAsync(request); Assert.Contains("PAYOUT_GROUP_SUSPENDED", await rejected.Content.ReadAsStringAsync());
    }
    [Theory] [InlineData("PayoutAttempts")] [InlineData("PayoutProviderEvents")] [InlineData("PayoutBeneficiaries")]
    public async Task PayoutHistoryIsImmutableInPostgres(string table)
    {
        var (s, _, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await PayoutAction(p.Id, s.OwnerId, "execute");
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        var sql = table switch { "PayoutAttempts" => "UPDATE payouts.\"PayoutAttempts\" SET \"Amount\" = 1", "PayoutProviderEvents" => "UPDATE payouts.\"PayoutProviderEvents\" SET \"Matched\" = false", _ => "UPDATE payouts.\"PayoutBeneficiaries\" SET \"MaskedAccountNumber\" = '****9999'" };
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql));
    }
    [Fact] public async Task PayoutAuctionSettlesEveryBenefitAndInternalFeeBeforeCompletion()
    {
        var (s, cycle) = await AuctionReady(); using var owner = Owner(s); using var bidder = Client(s.MemberIds[0]); await BidResponse(PlaceBid(bidder, s, cycle.Id));
        await AuctionResponse(ManageAuction(owner, s, cycle.Id, "close")); await Funding(s, cycle.Id); var rows = await Prepare(s, cycle.Id);
        Assert.Equal(21, rows.Length); var winner = Assert.Single(rows, p => p.PayoutType == PayoutType.WinnerPayout); Assert.Equal(35000, winner.Amount);
        var benefits = rows.Where(p => p.PayoutType == PayoutType.MemberAuctionBenefit).ToArray(); Assert.Equal(19, benefits.Length); Assert.All(benefits, p => Assert.Equal(750, p.Amount));
        var fee = Assert.Single(rows, p => p.PayoutType == PayoutType.PlatformFeeSettlement); Assert.Equal(750, fee.Amount); Assert.Equal(PayoutStatus.Succeeded, fee.Status); Assert.Equal(fee.AllocationJournalId, fee.SettlementJournalId);
        foreach (var p in rows.Where(p => p.PayoutType != PayoutType.PlatformFeeSettlement))
        {
            await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve");
            if (p.Id == benefits[^1].Id) continue;
            await PayoutAction(p.Id, s.OwnerId, "execute");
        }
        using (var scope = fixture.Factory.Services.CreateScope()) Assert.Equal(CycleStatus.SelectionCompleted, (await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
        await PayoutAction(benefits[^1].Id, s.OwnerId, "execute");
        using var check = fixture.Factory.Services.CreateScope(); var db = check.ServiceProvider.GetRequiredService<PayoutsDbContext>(); Assert.Equal(20, await db.Attempts.CountAsync(a => db.Obligations.Any(p => p.Id == a.PayoutObligationId && p.CycleId == cycle.Id)));
        var ledger = check.ServiceProvider.GetRequiredService<LedgerDbContext>(); var journals = await ledger.Journals.Where(j => j.SourceModule == "Payouts").ToArrayAsync(); Assert.All(journals, j => Assert.Equal(j.DebitTotal, j.CreditTotal));
        Assert.Equal(CycleStatus.Completed, (await check.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
    }
    [Fact] public async Task PayoutFinalCycleCompletesGroupAndEveryMemberWinsExactlyOnce()
    {
        var s = await Seed(); using var owner = Owner(s); var schedule = await Activate(owner, s); var winners = new HashSet<Guid>();
        foreach (var c in schedule)
        {
            foreach (var row in await Rows(owner, s, c.Id)) await Result(Operation(owner, s, row, new Dhanvi.Modules.Groups.Application.RecordContributionRequest(2500, "final-cycle", null), row.Id.ToString()));
            var selected = await Selection(Select(owner, s, c.Id)); Assert.True(winners.Add(selected.Winner.MembershipId));
            await Funding(s, c.Id); var p = Assert.Single(await Prepare(s, c.Id)); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await PayoutAction(p.Id, s.OwnerId, "execute");
        }
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); var group = await db.Groups.SingleAsync(g => g.Id == s.GroupId);
        Assert.Equal(20, winners.Count); Assert.Equal(GroupStatus.Completed, group.Status); Assert.NotNull(group.CompletedAt); Assert.Equal(20, group.CurrentCycleNumber);
        Assert.All(await db.MonthlyCycles.Where(c => c.GroupId == s.GroupId).ToArrayAsync(), c => { Assert.Equal(CycleStatus.Completed, c.Status); Assert.NotNull(c.PayoutCompletedAt); Assert.NotNull(c.CompletedAt); });
        Assert.Equal(400, await db.Contributions.CountAsync(c => c.GroupId == s.GroupId)); Assert.Equal(1, await db.AuditEvents.CountAsync(e => e.GroupId == s.GroupId && e.Action == "GROUP_COMPLETED"));
        using var response = await owner.PostAsJsonAsync($"/api/v1/admin/cycles/{schedule[^1].Id}/evaluate-settlement", new { }); Assert.True(response.IsSuccessStatusCode);
    }
    [Fact] public async Task PayoutDatabaseRejectsAmountDestinationAndPrematureCompletionChanges()
    {
        var (s, cycle, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve");
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payouts.\"PayoutObligations\" SET \"Amount\" = 1 WHERE \"Id\" = {p.Id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payouts.\"PayoutObligations\" SET \"BeneficiaryId\" = NULL WHERE \"Id\" = {p.Id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE groups.\"MonthlyCycles\" SET \"Status\" = 'Completed', \"CompletedAt\" = now(), \"PayoutCompletedAt\" = now() WHERE \"Id\" = {cycle}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE groups.\"MonthlyCycles\" SET \"Status\" = 'CollectingContributions' WHERE \"GroupId\" = {s.GroupId} AND \"CycleNumber\" = 2"));
    }
    [Fact] public async Task PayoutOrganizerCanInspectOwnGroupButCannotOperateOrApproveSelf()
    {
        var (s, _, p) = await PayoutReady(true); using var organizer = Owner(s); using var member = Client(s.MemberIds[1], "ORGANIZER");
        var list = (await organizer.GetFromJsonAsync<PayoutPage>($"/api/v1/organizer/groups/{s.GroupId}/payouts", Json))!; Assert.Contains(list.Items, x => x.Id == p.Id);
        using var denied = await member.GetAsync($"/api/v1/organizer/groups/{s.GroupId}/payouts"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var operate = await organizer.PostAsJsonAsync($"/api/v1/admin/payouts/{p.Id}/reconcile", new { }); Assert.Equal(HttpStatusCode.Forbidden, operate.StatusCode);
        await AddPayoutAccount(s.OwnerId); using var selfAdmin = Client(s.OwnerId, "ADMIN"); using var self = await selfAdmin.PostAsJsonAsync($"/api/v1/admin/payouts/{p.Id}/approve", new { }); Assert.Contains("PAYOUT_SELF_APPROVAL_NOT_ALLOWED", await self.Content.ReadAsStringAsync());
        await PayoutAction(p.Id, s.MemberIds[1], "approve"); Assert.Equal(PayoutStatus.Succeeded, (await PayoutAction(p.Id, s.MemberIds[1], "execute")).Status);
    }
    [Fact] public async Task PayoutDuplicateProviderObservationsAndLatePendingDoNotRegressSuccess()
    {
        var (s, _, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await ReservePending(p.Id, s.OwnerId);
        await Task.WhenAll(PayoutAction(p.Id, s.OwnerId, "reconcile"), PayoutAction(p.Id, s.OwnerId, "reconcile"));
        using (var scope = fixture.Factory.Services.CreateScope()) Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<PayoutsDbContext>().Events.CountAsync(e => e.PayoutObligationId == p.Id));
        await SetFakeOutcome(p.Id, GatewayPayoutStatus.Success); await Task.WhenAll(PayoutAction(p.Id, s.OwnerId, "reconcile"), PayoutAction(p.Id, s.OwnerId, "reconcile"));
        await SetFakeOutcome(p.Id, GatewayPayoutStatus.Pending); Assert.Equal(PayoutStatus.Succeeded, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
        using var check = fixture.Factory.Services.CreateScope(); Assert.Equal(2, await check.ServiceProvider.GetRequiredService<PayoutsDbContext>().Events.CountAsync(e => e.PayoutObligationId == p.Id));
    }
    [Fact] public async Task PayoutCapturedContributionsFundTheCompleteIncomingToOutgoingFlow()
    {
        var (s, cycle, rows) = await PaymentScenario();
        foreach (var row in rows) { var order = await Order(row); await Verify(order, fixture.Gateway.Observe(order.Payment.ProviderOrderId!)); }
        using var owner = Owner(s); await Selection(Select(owner, s, cycle.Id)); var p = Assert.Single(await Prepare(s, cycle.Id));
        await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await PayoutAction(p.Id, s.OwnerId, "execute");
        using var scope = fixture.Factory.Services.CreateScope(); var ledger = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var accounts = await ledger.Accounts.ToDictionaryAsync(a => a.Code);
        var lines = await ledger.Lines.Where(l => l.GroupId == s.GroupId && l.CycleId == cycle.Id).ToArrayAsync();
        Assert.Equal(lines.Sum(l => l.DebitAmount), lines.Sum(l => l.CreditAmount)); Assert.Equal(0, lines.Where(l => l.AccountId == accounts[ChartOfAccounts.GroupPool].Id).Sum(l => l.CreditAmount - l.DebitAmount));
        Assert.Equal(0, lines.Where(l => l.AccountId == accounts[ChartOfAccounts.MemberPayout].Id).Sum(l => l.CreditAmount - l.DebitAmount));
    }
    [Fact] public async Task PayoutCannotExecuteAgainstReversedFunding()
    {
        var (s, _, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await ReverseLedger(p.AllocationJournalId, Guid.NewGuid(), s.OwnerId);
        using var admin = Client(s.OwnerId, "ADMIN"); using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/admin/payouts/{p.Id}/execute") { Content = JsonContent.Create(new { }) }; request.Headers.Add("Idempotency-Key", "reversed");
        using var denied = await admin.SendAsync(request); Assert.Contains("INSUFFICIENT_FUNDED_POOL", await denied.Content.ReadAsStringAsync());
    }
    [Fact] public async Task PayoutLedgerFailureRollsBackObservationSettlementAuditAndCycle()
    {
        var (s, cycle, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve"); await ReservePending(p.Id, s.OwnerId); await SetFakeOutcome(p.Id, GatewayPayoutStatus.Success);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        var function = "fail_payout_" + Guid.NewGuid().ToString("N");
        var install = $"CREATE FUNCTION payouts.{function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"ReferenceId\" = '{p.Id}'::uuid THEN RAISE EXCEPTION 'Injected payout ledger failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER {function} BEFORE INSERT ON ledger.\"JournalLines\" FOR EACH ROW EXECUTE FUNCTION payouts.{function}();";
        await db.Database.ExecuteSqlRawAsync(install);
        try
        {
            using var admin = Client(s.OwnerId, "ADMIN"); using var response = await admin.PostAsJsonAsync($"/api/v1/admin/payouts/{p.Id}/reconcile", new { }); Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Equal(PayoutStatus.Processing, (await db.Obligations.AsNoTracking().SingleAsync(x => x.Id == p.Id)).Status);
            Assert.False(await db.Events.AnyAsync(e => e.PayoutObligationId == p.Id)); Assert.False(await db.History.AnyAsync(h => h.PayoutObligationId == p.Id && h.Action == "PAYOUT_SUCCEEDED"));
            Assert.Equal(CycleStatus.SelectionCompleted, (await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle)).Status);
        }
        finally { var cleanup = $"DROP TRIGGER {function} ON ledger.\"JournalLines\"; DROP FUNCTION payouts.{function}();"; await db.Database.ExecuteSqlRawAsync(cleanup); }
        Assert.Equal(PayoutStatus.Succeeded, (await PayoutAction(p.Id, s.OwnerId, "reconcile")).Status);
    }
    [Fact] public async Task PayoutCrashBeforeProviderCallRecoversSameDurableIntent()
    {
        var (s, _, p) = await PayoutReady(); await AddPayoutAccount(await PayoutUser(p.Id)); await PayoutAction(p.Id, s.OwnerId, "approve");
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PayoutsDbContext>(); var stored = await db.Obligations.SingleAsync(x => x.Id == p.Id); var b = await db.Beneficiaries.SingleAsync(x => x.Id == stored.BeneficiaryId);
            stored.Begin(false, fixture.Clock.UtcNow); await db.SaveChangesAsync(); db.Attempts.Add(PayoutAttempt.Create(stored, b, 1, "crash", s.OwnerId, fixture.Clock.UtcNow)); await db.SaveChangesAsync();
        }
        await Task.WhenAll(PayoutAction(p.Id, s.OwnerId, "reconcile"), PayoutAction(p.Id, s.OwnerId, "reconcile"));
        using var check = fixture.Factory.Services.CreateScope(); var result = check.ServiceProvider.GetRequiredService<PayoutsDbContext>();
        Assert.Equal(1, await result.Attempts.CountAsync(a => a.PayoutObligationId == p.Id)); Assert.Equal(1, await result.FakePayouts.CountAsync(a => a.Reference == p.Id.ToString("N")));
        Assert.Equal(PayoutStatus.Succeeded, (await result.Obligations.SingleAsync(x => x.Id == p.Id)).Status);
    }
}
