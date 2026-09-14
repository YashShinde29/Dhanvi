using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dhanvi.Modules.Payments.Application;
using Microsoft.Extensions.Options;
namespace Dhanvi.Modules.Payments.Infrastructure;

public sealed class RazorpayOptions
{
    public bool Enabled { get; set; }
    public string Environment { get; set; } = "TEST";
    public string KeyId { get; set; } = "";
    public string KeySecret { get; set; } = "";
    // Standard web Checkout uses its handler; this setting does not enable a redirect callback.
    public string CheckoutReturnBaseUrl { get; set; } = "";
    public bool WebhookEnabled { get; set; } = true;
    public string WebhookSecret { get; set; } = "";
    public bool Valid() => Environment == "TEST" && (string.IsNullOrEmpty(KeyId) || KeyId.StartsWith("rzp_test_", StringComparison.Ordinal)) &&
        (string.IsNullOrEmpty(CheckoutReturnBaseUrl) || Uri.TryCreate(CheckoutReturnBaseUrl, UriKind.Absolute, out var returnUrl) &&
            (returnUrl.Scheme == Uri.UriSchemeHttps || returnUrl.Scheme == Uri.UriSchemeHttp && returnUrl.IsLoopback) &&
            string.IsNullOrEmpty(returnUrl.UserInfo) && string.IsNullOrEmpty(returnUrl.Fragment)) &&
        (!Enabled || KeyId.Length > 9 && !string.IsNullOrWhiteSpace(KeySecret) && (!WebhookEnabled || !string.IsNullOrWhiteSpace(WebhookSecret)));
}
public static class RazorpaySignatures
{
    public static bool Verify(ReadOnlySpan<byte> data, string signature, string secret)
    {
        if (string.IsNullOrWhiteSpace(secret) || signature.Length != 64) return false;
        byte[] provided;
        try { provided = Convert.FromHexString(signature); }
        catch (FormatException) { return false; }
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), data);
        return CryptographicOperations.FixedTimeEquals(expected, provided);
    }
}
public sealed class RazorpayPaymentGateway(HttpClient http, IOptions<RazorpayOptions> options) : IPaymentGateway
{
    public string PublicKey => options.Value.KeyId;
    public bool Enabled => options.Value.Enabled;
    public bool VerifyPaymentSignature(string order, string payment, string signature) =>
        RazorpaySignatures.Verify(Encoding.UTF8.GetBytes(order + "|" + payment), signature, options.Value.KeySecret);
    public bool VerifyWebhookSignature(ReadOnlyMemory<byte> body, string signature) => options.Value.WebhookEnabled && RazorpaySignatures.Verify(body.Span, signature, options.Value.WebhookSecret);
    public async Task<GatewayOrder> CreateOrderAsync(Guid paymentId, Guid contributionId, Guid groupId, Guid cycleId, long amount, string receipt, CancellationToken ct)
    {
        using var response = await Send(HttpMethod.Post, "orders", new { amount, currency = "INR", receipt, partial_payment = false,
            notes = new { DhanviPaymentId = paymentId, ContributionId = contributionId, GroupId = groupId, CycleId = cycleId } }, ct);
        return Order(response.RootElement);
    }
    public async Task<GatewayOrder> GetOrderAsync(string id, CancellationToken ct)
    { using var json = await Send(HttpMethod.Get, "orders/" + Uri.EscapeDataString(id), null, ct); return Order(json.RootElement); }
    public async Task<IReadOnlyList<GatewayOrder>> FindOrdersAsync(string receipt, CancellationToken ct)
    { using var json = await Send(HttpMethod.Get, "orders?receipt=" + Uri.EscapeDataString(receipt) + "&count=100", null, ct); return json.RootElement.GetProperty("items").EnumerateArray().Select(Order).ToArray(); }
    public async Task<GatewayPayment> GetPaymentAsync(string id, CancellationToken ct)
    { using var json = await Send(HttpMethod.Get, "payments/" + Uri.EscapeDataString(id), null, ct); return Payment(json.RootElement); }
    public async Task<IReadOnlyList<GatewayPayment>> GetOrderPaymentsAsync(string order, CancellationToken ct)
    { using var json = await Send(HttpMethod.Get, "orders/" + Uri.EscapeDataString(order) + "/payments", null, ct); return json.RootElement.GetProperty("items").EnumerateArray().Select(Payment).ToArray(); }
    private async Task<JsonDocument> Send(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        if (!Enabled || !options.Value.Valid()) throw new InvalidOperationException("Razorpay Test configuration is not enabled.");
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(options.Value.KeyId + ":" + options.Value.KeySecret)));
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await http.SendAsync(request, ct);
        // Provider error payloads can contain customer information. Never propagate or log them.
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("Razorpay request failed; reconcile before retrying.", null, response.StatusCode);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }
    public GatewayEvent ParseWebhook(ReadOnlyMemory<byte> body)
    {
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement; var type = root.GetProperty("event").GetString()!;
        var payload = root.GetProperty("payload");
        GatewayPayment? payment = payload.TryGetProperty("payment", out var p) ? Payment(p.GetProperty("entity")) : null;
        GatewayRefund? refund = null;
        if (payload.TryGetProperty("refund", out var r))
        {
            var e = r.GetProperty("entity");
            refund = new(Text(e, "id"), Text(e, "payment_id"), e.GetProperty("amount").GetInt64(), Text(e, "status"));
        }
        return new(type, payment, refund);
    }
    private static string Text(JsonElement e, string key) => e.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";
    private static GatewayOrder Order(JsonElement e) => new(Text(e, "id"), e.GetProperty("amount").GetInt64(), Text(e, "currency"),
        Text(e, "receipt"), Text(e, "status"), e.TryGetProperty("attempts", out var attempts) ? attempts.GetInt32() : 0);
    private static GatewayPayment Payment(JsonElement e) => new(Text(e, "id"), Text(e, "order_id"), e.GetProperty("amount").GetInt64(),
        Text(e, "currency"), Text(e, "status"), e.TryGetProperty("captured", out var captured) && captured.ValueKind == JsonValueKind.True,
        e.TryGetProperty("amount_refunded", out var refunded) ? refunded.GetInt64() : 0, DateTimeOffset.FromUnixTimeSeconds(e.GetProperty("created_at").GetInt64()));
}
