import type { RazorpayConfig } from "../../config/payment.js";
import { verifyHmacSha256Hex } from "../../utils/crypto.js";

/** Gateway shapes (amounts in paise as bigint; Razorpay never sends fractional minor units). */
export interface GatewayOrder { id: string; amount: bigint; currency: string; receipt: string; status: string; attempts: number }
export interface GatewayPayment { id: string; orderId: string; amount: bigint; currency: string; status: string; captured: boolean; amountRefunded: bigint; createdAt: Date }
export interface GatewayRefund { id: string; paymentId: string; amount: bigint; status: string }
export interface GatewayEvent { type: string; payment: GatewayPayment | null; refund: GatewayRefund | null }

/** Transport failure or non-2xx provider answer: the outcome is uncertain and must be reconciled, never blindly retried. */
export class GatewayUnavailableError extends Error {}
/** Webhook body did not have the expected structure (port of JsonException / KeyNotFoundException handling). */
export class InvalidProviderEventError extends Error {}

export interface PaymentGateway {
  readonly publicKey: string;
  readonly enabled: boolean;
  createOrder(paymentId: string, contributionId: string, groupId: string, cycleId: string, amount: bigint, receipt: string): Promise<GatewayOrder>;
  getOrder(id: string): Promise<GatewayOrder>;
  findOrders(receipt: string): Promise<GatewayOrder[]>;
  getPayment(id: string): Promise<GatewayPayment>;
  getOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  verifyPaymentSignature(order: string, payment: string, signature: string): boolean;
  /** HMAC over the exact raw request bytes — never over re-serialized JSON. */
  verifyWebhookSignature(body: Buffer, signature: string): boolean;
  parseWebhook(body: Buffer): GatewayEvent;
}

type Json = Record<string, unknown>;
const text = (e: Json, key: string) => (typeof e[key] === "string" ? (e[key] as string) : "");
const int = (e: Json, key: string): bigint => {
  const v = e[key];
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new InvalidProviderEventError(`Missing integer ${key}`);
};
const toOrder = (e: Json): GatewayOrder => ({ id: text(e, "id"), amount: int(e, "amount"), currency: text(e, "currency"), receipt: text(e, "receipt"), status: text(e, "status"),
  attempts: typeof e.attempts === "number" ? e.attempts : 0 });
const toPayment = (e: Json): GatewayPayment => ({ id: text(e, "id"), orderId: text(e, "order_id"), amount: int(e, "amount"), currency: text(e, "currency"), status: text(e, "status"),
  captured: e.captured === true, amountRefunded: e.amount_refunded === undefined ? 0n : int(e, "amount_refunded"), createdAt: new Date(Number(int(e, "created_at")) * 1000) });

/** Port of RazorpayPaymentGateway: TEST mode REST v1 with basic auth, 15 s timeout, provider bodies never logged. */
export class RazorpayGateway implements PaymentGateway {
  constructor(private readonly config: RazorpayConfig, private readonly fetchImpl: typeof fetch = fetch) {}
  get publicKey() { return this.config.keyId; }
  get enabled() { return this.config.enabled; }

  verifyPaymentSignature(order: string, payment: string, signature: string): boolean {
    return verifyHmacSha256Hex(Buffer.from(`${order}|${payment}`, "utf8"), signature, this.config.keySecret);
  }
  verifyWebhookSignature(body: Buffer, signature: string): boolean {
    return this.config.webhookEnabled && verifyHmacSha256Hex(body, signature, this.config.webhookSecret);
  }

  async createOrder(paymentId: string, contributionId: string, groupId: string, cycleId: string, amount: bigint, receipt: string) {
    return toOrder(await this.send("POST", "orders", { amount: Number(amount), currency: "INR", receipt, partial_payment: false,
      notes: { DhanviPaymentId: paymentId, ContributionId: contributionId, GroupId: groupId, CycleId: cycleId } }));
  }
  async getOrder(id: string) { return toOrder(await this.send("GET", `orders/${encodeURIComponent(id)}`)); }
  async findOrders(receipt: string) { return ((await this.send("GET", `orders?receipt=${encodeURIComponent(receipt)}&count=100`)).items as Json[]).map(toOrder); }
  async getPayment(id: string) { return toPayment(await this.send("GET", `payments/${encodeURIComponent(id)}`)); }
  async getOrderPayments(order: string) { return ((await this.send("GET", `orders/${encodeURIComponent(order)}/payments`)).items as Json[]).map(toPayment); }

  parseWebhook(body: Buffer): GatewayEvent {
    let root: Json;
    try { root = JSON.parse(body.toString("utf8")) as Json; } catch { throw new InvalidProviderEventError("Invalid JSON"); }
    if (typeof root?.event !== "string" || typeof root.payload !== "object" || root.payload === null) throw new InvalidProviderEventError("Missing event");
    const payload = root.payload as Json;
    const entity = (key: string) => { const v = payload[key] as Json | undefined; if (!v) return null; if (typeof v.entity !== "object" || v.entity === null) throw new InvalidProviderEventError("Missing entity"); return v.entity as Json; };
    const p = entity("payment"); const r = entity("refund");
    return { type: root.event, payment: p && toPayment(p), refund: r && { id: text(r, "id"), paymentId: text(r, "payment_id"), amount: int(r, "amount"), status: text(r, "status") } };
  }

  private async send(method: "GET" | "POST", path: string, body?: unknown): Promise<Json> {
    if (!this.config.enabled) throw new Error("Razorpay Test configuration is not enabled.");
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.config.apiBaseUrl), {
        method, signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString("base64")}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GatewayUnavailableError("Razorpay request failed; reconcile before retrying.");
    }
    // Provider error payloads can contain customer information. Never propagate or log them.
    if (!response.ok) throw new GatewayUnavailableError("Razorpay request failed; reconcile before retrying.");
    try { return (await response.json()) as Json; } catch { throw new GatewayUnavailableError("Razorpay returned an unreadable response."); }
  }
}
