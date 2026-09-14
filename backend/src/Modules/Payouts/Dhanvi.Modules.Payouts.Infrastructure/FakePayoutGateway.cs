using Dhanvi.Modules.Payouts.Application;
using Dhanvi.Modules.Payouts.Domain;
using Dhanvi.Modules.Payouts.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
namespace Dhanvi.Modules.Payouts.Infrastructure;
public sealed class FakeProviderPayout
{
    public string Id { get; set; } = "";
    public string IdempotencyKey { get; set; } = "";
    public string FundAccountId { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "INR";
    public string Reference { get; set; } = "";
    public GatewayPayoutStatus Status { get; set; }
    public int Revision { get; set; }
    public GatewayPayout View() => new(Id, FundAccountId, Amount, Currency, Reference, Status, Id + ":" + Revision);
}
// An independent durable fake-provider store allows request recovery across API restarts.
// No HTTP client, credentials or production adapter is registered.
public sealed class FakePayoutGateway(IConfiguration configuration) : IPayoutGateway
{
    public string Provider => "FAKE";
    private PayoutsDbContext Context() => new(new DbContextOptionsBuilder<PayoutsDbContext>().UseNpgsql(configuration.GetConnectionString("DefaultConnection")).Options);
    public Task<string> CreateFundAccountAsync(Guid reference, CancellationToken ct) => Task.FromResult("fake_fa_" + reference.ToString("N"));
    public async Task<GatewayPayout> InitiatePayoutAsync(GatewayPayoutRequest request, CancellationToken ct)
    {
        var r = request;
        PayoutMoney.Validate(r.Amount);
        BusinessRuleException.Require(r.Currency == "INR" && r.ProviderPayoutId.StartsWith("fake_po_", StringComparison.Ordinal) && r.FundAccountId.StartsWith("fake_fa_", StringComparison.Ordinal), "PAYOUT_NOT_READY", "Only fake test payouts are supported.");
        await using var db = Context(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({r.IdempotencyKey}, 91))", ct);
        var row = await db.FakePayouts.SingleOrDefaultAsync(x => x.IdempotencyKey == r.IdempotencyKey, ct);
        if (row is null)
        {
            var status = Enum.Parse<GatewayPayoutStatus>(configuration["Payouts:Fake:Outcome"] ?? "Success", true);
            row = new() { Id = r.ProviderPayoutId, IdempotencyKey = r.IdempotencyKey, FundAccountId = r.FundAccountId, Amount = r.Amount, Currency = r.Currency, Reference = r.Reference, Status = status };
            db.FakePayouts.Add(row); await db.SaveChangesAsync(ct);
        }
        BusinessRuleException.Require(row.Id == r.ProviderPayoutId && row.FundAccountId == r.FundAccountId && row.Amount == r.Amount && row.Currency == r.Currency && row.Reference == r.Reference,
            "PAYOUT_AMOUNT_MISMATCH", "A provider idempotency key cannot be reused with different instructions.");
        await tx.CommitAsync(ct); return row.View();
    }
    public async Task<GatewayPayout?> GetPayoutStatusAsync(string providerId, CancellationToken ct)
    {
        await using var db = Context(); return (await db.FakePayouts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == providerId, ct))?.View();
    }
}
