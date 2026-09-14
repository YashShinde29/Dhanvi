using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dhanvi.Modules.Payments.Application;
using Dhanvi.Modules.Payments.Infrastructure;
using Microsoft.Extensions.Options;

namespace Dhanvi.IntegrationTests.Api;

// Test-only provider state. Real signature validation and webhook parsing run offline.
public sealed class FakePaymentGateway : IPaymentGateway
{
    public const string SigningSecret = "offline-test-signature-key";
    public const string WebhookSecret = "offline-test-webhook-key";
    private readonly RazorpayPaymentGateway _parser = new(new HttpClient(), Options.Create(new RazorpayOptions
        { Enabled = true, KeyId = "rzp_test_offline", KeySecret = SigningSecret, WebhookSecret = WebhookSecret }));
    public ConcurrentDictionary<string, GatewayOrder> Orders { get; } = new();
    public ConcurrentDictionary<string, GatewayPayment> Payments { get; } = new();
    public bool Enabled => true;
    public string PublicKey => "rzp_test_offline";
    public Task<GatewayOrder> CreateOrderAsync(Guid paymentId, Guid contributionId, Guid groupId, Guid cycleId, long amount, string receipt, CancellationToken ct)
    {
        var order = new GatewayOrder("order_" + Guid.NewGuid().ToString("N"), amount, "INR", receipt, "created");
        Orders[order.Id] = order; return Task.FromResult(order);
    }
    public GatewayPayment Observe(string orderId, string status = "captured", string? id = null, long? amount = null, long refunded = 0)
    {
        var order = Orders[orderId];
        var payment = new GatewayPayment(id ?? "pay_" + Guid.NewGuid().ToString("N"), order.Id, amount ?? order.Amount, "INR", status,
            status is "captured" or "refunded", refunded, DateTimeOffset.UtcNow);
        Payments[payment.Id] = payment;
        Orders[order.Id] = order with { Status = payment.Captured ? "paid" : "attempted" };
        return payment;
    }
    public static string Sign(byte[] bytes, string secret) => Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), bytes));
    public static VerifyPaymentRequest Verification(GatewayPayment payment) => new(payment.OrderId, payment.Id,
        Sign(Encoding.UTF8.GetBytes(payment.OrderId + "|" + payment.Id), SigningSecret));
    public static byte[] Body(GatewayPayment payment, string type = "payment.captured", GatewayRefund? refund = null) => JsonSerializer.SerializeToUtf8Bytes(new
    {
        @event = type,
        payload = refund is null ? (object)new { payment = new { entity = Entity(payment) } } :
            new { payment = new { entity = Entity(payment) }, refund = new { entity = new { id = refund.Id, payment_id = refund.PaymentId, amount = refund.Amount, status = refund.Status } } }
    });
    private static object Entity(GatewayPayment p) => new { id = p.Id, order_id = p.OrderId, amount = p.Amount, currency = p.Currency, status = p.Status, captured = p.Captured, amount_refunded = p.AmountRefunded, created_at = p.CreatedAt.ToUnixTimeSeconds() };
    public Task<GatewayOrder> GetOrderAsync(string id, CancellationToken ct) => Task.FromResult(Orders[id]);
    public Task<GatewayPayment> GetPaymentAsync(string id, CancellationToken ct) => Task.FromResult(Payments[id]);
    public Task<IReadOnlyList<GatewayOrder>> FindOrdersAsync(string receipt, CancellationToken ct) => Task.FromResult<IReadOnlyList<GatewayOrder>>(Orders.Values.Where(o => o.Receipt == receipt).ToArray());
    public Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(string order, CancellationToken ct) => Task.FromResult<IReadOnlyList<GatewayPayment>>(Payments.Values.Where(p => p.OrderId == order).ToArray());
    public bool VerifyPaymentSignature(string order, string payment, string signature) => _parser.VerifyPaymentSignature(order, payment, signature);
    public bool VerifyWebhookSignature(ReadOnlyMemory<byte> body, string signature) => _parser.VerifyWebhookSignature(body, signature);
    public GatewayEvent ParseWebhook(ReadOnlyMemory<byte> body) => _parser.ParseWebhook(body);
}
