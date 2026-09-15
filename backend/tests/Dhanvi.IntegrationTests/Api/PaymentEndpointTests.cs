using System.Net;
using System.Net.Http.Json;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.Modules.Ledger.Infrastructure.Persistence;
using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Domain;
using Dhanvi.Modules.Payments.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dhanvi.IntegrationTests.Api;

public sealed partial class CycleEndpointTests
{
    private async Task<(Scenario S, CycleDetails Cycle, List<ContributionDetails> Rows)> PaymentScenario()
    {
        var s = await Seed(collectionMode: ContributionCollectionMode.Razorpay);
        using var owner = Owner(s); var cycle = (await Activate(owner, s))[0];
        return (s, cycle, await Rows(owner, s, cycle.Id));
    }
    private async Task<CheckoutView> Order(ContributionDetails row, string? key = null)
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().Memberships.Where(m => m.Id == row.MembershipId).Select(m => m.UserId).SingleAsync();
        using var client = Client(user);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contributions/{row.Id}/payments")
            { Content = JsonContent.Create(new { amount = 1, currency = "USD" }) };
        request.Headers.Add("Idempotency-Key", key ?? row.Id.ToString());
        using var response = await client.SendAsync(request);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<CheckoutView>(Json))!;
    }
    private async Task<PaymentView> Verify(CheckoutView checkout, GatewayPayment remote)
    {
        using var client = Client(checkout.Payment.UserId);
        using var response = await client.PostAsJsonAsync($"/api/v1/payments/{checkout.Payment.Id}/verify", FakePaymentGateway.Verification(remote));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<PaymentView>(Json))!;
    }
    private async Task Webhook(GatewayPayment remote, string? key = null, string type = "payment.captured", GatewayRefund? refund = null)
    {
        var body = FakePaymentGateway.Body(remote, type, refund);
        using var client = fixture.Factory.CreateClient(); using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payments/webhooks/razorpay") { Content = new ByteArrayContent(body) };
        request.Headers.Add("X-Razorpay-Signature", FakePaymentGateway.Sign(body, FakePaymentGateway.WebhookSecret));
        if (key is not null) request.Headers.Add("X-Razorpay-Event-Id", key);
        using var response = await client.SendAsync(request); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
    }
    private async Task<PaymentView> Reconcile(CheckoutView checkout)
    {
        using var client = Client(checkout.Payment.UserId);
        using var response = await client.PostAsJsonAsync($"/api/v1/payments/{checkout.Payment.Id}/refresh", new { });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<PaymentView>(Json))!;
    }
    private async Task AssertSettlement(CheckoutView checkout, bool settled, int journals = 1)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var groups = scope.ServiceProvider.GetRequiredService<GroupsDbContext>();
        var c = await groups.Contributions.SingleAsync(c => c.Id == checkout.Payment.ContributionId);
        Assert.Equal(settled ? checkout.Payment.Amount : 0, c.FinanciallySettledAmount);
        var ledger = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
        var captures = await ledger.Journals.Include(j => j.Lines).Where(j => j.EventType == AccountingEventType.PaymentCaptured && j.EventId == checkout.Payment.Id).ToArrayAsync();
        Assert.Equal(journals, captures.Length);
        if (journals == 0) { Assert.False(await ledger.Lines.AnyAsync(l => l.PaymentId == checkout.Payment.Id)); return; }
        var j = Assert.Single(captures); Assert.Equal(2, j.Lines.Count); Assert.Equal(checkout.Payment.Amount, j.DebitTotal); Assert.Equal(j.DebitTotal, j.CreditTotal);
        var accounts = await ledger.Accounts.ToDictionaryAsync(a => a.Code);
        Assert.Equal(checkout.Payment.Amount, j.Lines.Single(l => l.AccountId == accounts[ChartOfAccounts.PaymentGatewayClearing].Id).DebitAmount);
        Assert.Equal(checkout.Payment.Amount, j.Lines.Single(l => l.AccountId == accounts[ChartOfAccounts.GroupPool].Id).CreditAmount);
    }

    [Fact] public async Task PaymentOrderUsesBackendAmountAndConcurrentCreationReusesOneProviderOrder()
    {
        var (_, _, rows) = await PaymentScenario();
        var orders = await Task.WhenAll(Order(rows[0], "one"), Order(rows[0], "two"));
        Assert.Equal(orders[0].Payment.Id, orders[1].Payment.Id);
        var order = await Order(rows[0], "one"); Assert.Equal(2500, order.Payment.Amount); Assert.Equal(250000, order.AmountInMinorUnits); Assert.Equal("INR", order.Payment.Currency);
        Assert.Equal(250000, fixture.Gateway.Orders[order.Payment.ProviderOrderId!].Amount);
        Assert.Single(fixture.Gateway.Orders.Values, o => o.Receipt == "dh_" + order.Payment.Id.ToString("N"));
    }
    [Fact] public async Task PaymentRejectsInvalidSignaturesAndUnauthorizedAccessWithoutSettlement()
    {
        var (s, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!);
        using var member = Client(order.Payment.UserId); using var invalid = await member.PostAsJsonAsync($"/api/v1/payments/{order.Payment.Id}/verify", FakePaymentGateway.Verification(remote) with { RazorpaySignature = new string('0', 64) });
        Assert.Equal(HttpStatusCode.Conflict, invalid.StatusCode); Assert.Contains("INVALID_PAYMENT_SIGNATURE", await invalid.Content.ReadAsStringAsync());
        using var stranger = Client(s.OwnerId); using var denied = await stranger.GetAsync($"/api/v1/payments/{order.Payment.Id}"); Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var anonymous = fixture.Factory.CreateClient(); using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payments/webhooks/razorpay") { Content = new ByteArrayContent(FakePaymentGateway.Body(remote)) };
        request.Headers.Add("X-Razorpay-Signature", new string('0', 64)); using var rejected = await anonymous.SendAsync(request);
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode); Assert.Contains("INVALID_WEBHOOK_SIGNATURE", await rejected.Content.ReadAsStringAsync());
        using var unsigned = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payments/webhooks/razorpay") { Content = new ByteArrayContent(FakePaymentGateway.Body(remote)) };
        using var missing = await anonymous.SendAsync(unsigned);
        Assert.Equal(HttpStatusCode.Conflict, missing.StatusCode); Assert.Contains("INVALID_WEBHOOK_SIGNATURE", await missing.Content.ReadAsStringAsync());
        await AssertSettlement(order, false, 0);
    }
    [Theory] [InlineData("authorized")] [InlineData("failed")]
    public async Task PaymentUncapturedEventsNeverSettleOrPostClearing(string status)
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!, status);
        await Webhook(remote, type: "payment." + status); var result = await Reconcile(order);
        Assert.Equal(status == "failed" ? PaymentStatus.Failed : PaymentStatus.Authorized, result.Status);
        await AssertSettlement(order, false, 0);
        using var member = Client(order.Payment.UserId);
        var eligibility = (await member.GetFromJsonAsync<PaymentEligibility>($"/api/v1/contributions/{order.Payment.ContributionId}/payment-eligibility", Json))!;
        Assert.Equal(status == "failed", eligibility.CanPay); Assert.Equal(order.Payment.Id, eligibility.PaymentId); Assert.Equal(order.Payment.Amount, eligibility.RemainingAmount);
    }
    [Theory] [InlineData(true)] [InlineData(false)]
    public async Task PaymentConcurrentVerificationAndDuplicateWebhooksSettleExactlyOnce(bool sameEvent)
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); var key = Guid.NewGuid().ToString();
        await Task.WhenAll(Verify(order, remote), Webhook(remote, key), Webhook(remote, sameEvent ? key : Guid.NewGuid().ToString()), Reconcile(order));
        await Verify(order, remote); await Webhook(remote, key); await AssertSettlement(order, true);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
        Assert.Equal(sameEvent ? 1 : 2, await db.Events.CountAsync(e => e.PaymentId == order.Payment.Id));
        Assert.Equal(1, await db.History.CountAsync(h => h.PaymentId == order.Payment.Id && h.Action == "PAYMENT_CAPTURED"));
    }
    [Fact] public async Task PaymentCompetingSuccessfulProviderIdsCannotOverSettle()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]);
        var a = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); var b = fixture.Gateway.Observe(order.Payment.ProviderOrderId!);
        await Task.WhenAll(Verify(order, a), Verify(order, b)); await AssertSettlement(order, true);
        Assert.Equal(PaymentStatus.ReconciliationRequired, (await Reconcile(order)).Status);
    }
    [Fact] public async Task PaymentOutOfOrderFailureAndAuthorizationCannotUndoCapture()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!);
        await Verify(order, remote);
        foreach (var status in new[] { "failed", "authorized" })
        {
            remote = fixture.Gateway.Observe(remote.OrderId, status, remote.Id);
            await Webhook(remote, Guid.NewGuid().ToString(), "payment." + status);
            Assert.Equal(PaymentStatus.Captured, (await Reconcile(order)).Status);
        }
        await AssertSettlement(order, true);
    }
    [Theory] [InlineData("amount")] [InlineData("currency")] [InlineData("capture")] [InlineData("order-status")]
    public async Task PaymentReconciliationMismatchIsStickyAndDoesNotSettle(string mismatch)
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!);
        fixture.Gateway.Payments[remote.Id] = mismatch switch { "amount" => remote with { Amount = 1 }, "currency" => remote with { Currency = "USD" }, "capture" => remote with { Captured = false }, _ => remote };
        if (mismatch == "order-status") fixture.Gateway.Orders[remote.OrderId] = fixture.Gateway.Orders[remote.OrderId] with { Status = "attempted" };
        var result = await Reconcile(order); Assert.Equal(PaymentStatus.ReconciliationRequired, result.Status); Assert.Equal(ReconciliationStatus.Mismatch, result.ReconciliationStatus);
        fixture.Gateway.Payments[remote.Id] = remote;
        fixture.Gateway.Orders[remote.OrderId] = fixture.Gateway.Orders[remote.OrderId] with { Status = "paid" };
        Assert.Equal(PaymentStatus.ReconciliationRequired, (await Reconcile(order)).Status); await AssertSettlement(order, false, 0);
    }
    [Fact] public async Task PaymentReconciliationChoosesMatchingCaptureOverFailedAttempt()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); fixture.Gateway.Observe(order.Payment.ProviderOrderId!, "failed");
        var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); var result = await Reconcile(order);
        Assert.Equal(remote.Id, result.ProviderPaymentId); Assert.Equal(ReconciliationStatus.Matched, result.ReconciliationStatus); await AssertSettlement(order, true);
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task PaymentFinancialReadinessAndRefundRespectSelectionBoundary(bool selected)
    {
        var (s, cycle, rows) = await PaymentScenario(); using var owner = Owner(s);
        // Operational records alone must never make a gateway cycle ready.
        foreach (var row in rows) await Result(Operation(owner, s, row, new RecordContributionRequest(2500, "manual", null), row.Id.ToString()));
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); Assert.Equal(CycleStatus.CollectingContributions, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
            Assert.False(await scope.ServiceProvider.GetRequiredService<PaymentsDbContext>().Payments.AnyAsync(p => p.GroupId == s.GroupId));
            Assert.False(await scope.ServiceProvider.GetRequiredService<LedgerDbContext>().Lines.AnyAsync(l => l.GroupId == s.GroupId));
        }
        CheckoutView? first = null; GatewayPayment? captured = null;
        for (var i = 0; i < rows.Count; i++)
        {
            var order = await Order(rows[i]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); await Verify(order, remote); first ??= order; captured ??= remote;
            if (i == rows.Count - 2)
            {
                using var scope = fixture.Factory.Services.CreateScope(); Assert.Equal(CycleStatus.CollectingContributions, (await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
            }
        }
        using (var scope = fixture.Factory.Services.CreateScope()) Assert.Equal(CycleStatus.ReadyForSelection, (await scope.ServiceProvider.GetRequiredService<GroupsDbContext>().MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
        if (selected) await Selection(Select(owner, s, cycle.Id));
        var refunded = fixture.Gateway.Observe(captured!.OrderId, "refunded", captured.Id, refunded: captured.Amount);
        var refund = new GatewayRefund("rfnd_" + Guid.NewGuid().ToString("N"), captured.Id, captured.Amount, "processed");
        await Task.WhenAll(Webhook(refunded, type: "refund.processed", refund: refund), Reconcile(first!));
        var result = await Reconcile(first!); Assert.Equal(selected ? PaymentStatus.ReconciliationRequired : PaymentStatus.Refunded, result.Status);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GroupsDbContext>(); Assert.Equal(selected ? CycleStatus.SelectionCompleted : CycleStatus.CollectingContributions, (await db.MonthlyCycles.SingleAsync(c => c.Id == cycle.Id)).Status);
            var ledger = scope.ServiceProvider.GetRequiredService<LedgerDbContext>(); var original = await ledger.Journals.Include(j => j.Lines).SingleAsync(j => j.Id == result.JournalId);
            var reversal = await ledger.Journals.Include(j => j.Lines).SingleOrDefaultAsync(j => j.ReversesJournalEntryId == original.Id);
            if (selected) Assert.Null(reversal);
            else { Assert.NotNull(reversal); foreach (var line in original.Lines) { var inverse = reversal.Lines.Single(l => l.AccountId == line.AccountId); Assert.Equal(line.DebitAmount, inverse.CreditAmount); Assert.Equal(line.CreditAmount, inverse.DebitAmount); } }
        }
        await AssertSettlement(first!, selected);
        if (!selected)
        {
            var retry = await Order(rows[0], "after-refund"); Assert.NotEqual(first!.Payment.Id, retry.Payment.Id);
            await Verify(retry, fixture.Gateway.Observe(retry.Payment.ProviderOrderId!)); await AssertSettlement(retry, true);
        }
    }
    [Fact] public async Task PaymentPartialRefundRequiresReviewAndPreservesSettlement()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); await Verify(order, remote);
        fixture.Gateway.Observe(remote.OrderId, "captured", remote.Id, refunded: 1);
        Assert.Equal(PaymentStatus.ReconciliationRequired, (await Reconcile(order)).Status); await AssertSettlement(order, true);
    }
    [Theory] [InlineData("history-update")] [InlineData("history-delete")] [InlineData("event-update")] [InlineData("event-delete")]
    [InlineData("payment-amount")] [InlineData("payment-delete")] [InlineData("payment-regress")] [InlineData("contribution-reset")] [InlineData("cycle-total")]
    public async Task PaymentDatabaseRejectsHistoryAndSettlementTampering(string operation)
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); await Webhook(remote);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
        var id = order.Payment.Id; var contribution = order.Payment.ContributionId; var cycle = order.Payment.CycleId;
        FormattableString sql = operation switch
        {
            "history-update" => $"UPDATE payments.\"PaymentHistory\" SET \"Message\" = 'changed' WHERE \"PaymentId\" = {id}",
            "history-delete" => $"DELETE FROM payments.\"PaymentHistory\" WHERE \"PaymentId\" = {id}",
            "event-update" => $"UPDATE payments.\"PaymentProviderEvents\" SET \"ProcessingStatus\" = 'changed' WHERE \"PaymentId\" = {id}",
            "event-delete" => $"DELETE FROM payments.\"PaymentProviderEvents\" WHERE \"PaymentId\" = {id}",
            "payment-amount" => $"UPDATE payments.\"Payments\" SET \"Amount\" = 1 WHERE \"Id\" = {id}",
            "payment-delete" => $"DELETE FROM payments.\"Payments\" WHERE \"Id\" = {id}",
            "payment-regress" => $"UPDATE payments.\"Payments\" SET \"Status\" = 'Failed' WHERE \"Id\" = {id}",
            "contribution-reset" => $"UPDATE groups.\"Contributions\" SET \"FinanciallySettledAmount\" = 0, \"SettledPaymentId\" = NULL, \"FinancialStatus\" = 'Refunded' WHERE \"Id\" = {contribution}",
            _ => $"UPDATE groups.\"MonthlyCycles\" SET \"FinanciallySettledAmount\" = 0 WHERE \"Id\" = {cycle}"
        };
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(sql)); await AssertSettlement(order, true);
    }
    [Fact] public async Task PaymentProviderIdsAreDatabaseUnique()
    {
        var (_, _, rows) = await PaymentScenario(); var first = await Order(rows[0]); var remote = fixture.Gateway.Observe(first.Payment.ProviderOrderId!); await Verify(first, remote);
        var second = await Order(rows[1]); using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
        var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments.\"Payments\" SET \"ProviderPaymentId\" = {remote.Id} WHERE \"Id\" = {second.Payment.Id}"));
        Assert.Equal("23505", error.SqlState);
    }
    [Fact] public async Task PaymentPendingAndFailedRefundKeepSettlementAndIgnoreLatePending()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); await Verify(order, remote);
        var refund = new GatewayRefund("rfnd_" + Guid.NewGuid().ToString("N"), remote.Id, remote.Amount, "pending");
        await Webhook(remote, type: "refund.created", refund: refund);
        Assert.Equal(PaymentStatus.RefundPending, (await Reconcile(order)).Status); await AssertSettlement(order, true);
        await Webhook(remote, type: "refund.failed", refund: refund with { Status = "failed" });
        Assert.Equal(PaymentStatus.Captured, (await Reconcile(order)).Status);
        await Webhook(remote, Guid.NewGuid().ToString(), "refund.created", refund);
        Assert.Equal(PaymentStatus.Captured, (await Reconcile(order)).Status); await AssertSettlement(order, true);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
        Assert.Equal(2, await db.Refunds.CountAsync(r => r.PaymentId == order.Payment.Id));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments.\"PaymentRefunds\" SET \"Status\" = 'processed' WHERE \"PaymentId\" = {order.Payment.Id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM payments.\"PaymentRefunds\" WHERE \"PaymentId\" = {order.Payment.Id}"));
    }
    [Fact] public async Task PaymentLedgerFailureRollsBackCaptureContributionEventAndCanRetry()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!);
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();
        var function = "fail_capture_" + Guid.NewGuid().ToString("N");
        var install = $"CREATE FUNCTION payments.{function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"PaymentId\" = '{order.Payment.Id}'::uuid THEN RAISE EXCEPTION 'Injected capture failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER {function} BEFORE INSERT ON ledger.\"JournalLines\" FOR EACH ROW EXECUTE FUNCTION payments.{function}();";
        await db.Database.ExecuteSqlRawAsync(install);
        try
        {
            using var client = Client(order.Payment.UserId); using var response = await client.PostAsJsonAsync($"/api/v1/payments/{order.Payment.Id}/verify", FakePaymentGateway.Verification(remote));
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode); await AssertSettlement(order, false, 0);
            var payment = await db.Payments.AsNoTracking().SingleAsync(p => p.Id == order.Payment.Id); Assert.Null(payment.CapturedAt); Assert.Null(payment.JournalId);
            Assert.False(await db.History.AnyAsync(h => h.PaymentId == payment.Id && h.Action == "PAYMENT_CAPTURED"));
        }
        finally { var cleanup = $"DROP TRIGGER {function} ON ledger.\"JournalLines\"; DROP FUNCTION payments.{function}();"; await db.Database.ExecuteSqlRawAsync(cleanup); }
        await Webhook(remote); await AssertSettlement(order, true);
    }
    [Fact] public async Task PaymentWebhookEventIdentityRejectsDifferentPayloadAndUnsignedMalformedBody()
    {
        var (_, _, rows) = await PaymentScenario(); var order = await Order(rows[0]); var remote = fixture.Gateway.Observe(order.Payment.ProviderOrderId!); var key = Guid.NewGuid().ToString(); await Webhook(remote, key);
        var bytes = FakePaymentGateway.Body(remote, "order.paid");
        using var client = fixture.Factory.CreateClient(); using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payments/webhooks/razorpay") { Content = new ByteArrayContent(bytes) };
        request.Headers.Add("X-Razorpay-Signature", FakePaymentGateway.Sign(bytes, FakePaymentGateway.WebhookSecret)); request.Headers.Add("X-Razorpay-Event-Id", key);
        using var response = await client.SendAsync(request); Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("PROVIDER_EVENT_REUSED", await response.Content.ReadAsStringAsync());
        var malformed = System.Text.Encoding.UTF8.GetBytes("{}"); using var bad = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payments/webhooks/razorpay") { Content = new ByteArrayContent(malformed) };
        bad.Headers.Add("X-Razorpay-Signature", FakePaymentGateway.Sign(malformed, FakePaymentGateway.WebhookSecret)); using var invalid = await client.SendAsync(bad); Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        await AssertSettlement(order, true);
    }
}
