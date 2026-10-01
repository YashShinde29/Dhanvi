import { createHmac, randomUUID } from "node:crypto";
import type { RazorpayConfig } from "../../src/config/payment.js";
import { type GatewayEvent, type GatewayOrder, type GatewayPayment, GatewayUnavailableError, type PaymentGateway, RazorpayGateway } from "../../src/infra/razorpay/razorpay.gateway.js";

/**
 * In-memory Razorpay TEST provider. Signature verification and webhook parsing reuse the real gateway code, so the
 * exact-bytes HMAC path is what is exercised; only the REST calls are simulated.
 */
export class FakeRazorpay implements PaymentGateway {
  orders = new Map<string, GatewayOrder>();
  payments = new Map<string, GatewayPayment>();
  failNextCreate = false;
  private readonly real: RazorpayGateway;
  constructor(private readonly config: RazorpayConfig) { this.real = new RazorpayGateway(config); }
  get publicKey() { return this.config.keyId; }
  get enabled() { return this.config.enabled; }

  async createOrder(_p: string, _c: string, _g: string, _y: string, amount: bigint, receipt: string): Promise<GatewayOrder> {
    if (this.failNextCreate) { this.failNextCreate = false; throw new GatewayUnavailableError("simulated timeout"); }
    const order = { id: `order_${randomUUID().replace(/-/g, "").slice(0, 14)}`, amount, currency: "INR", receipt, status: "created", attempts: 0 };
    this.orders.set(order.id, order);
    return { ...order };
  }
  async getOrder(id: string) { const o = this.orders.get(id); if (!o) throw new GatewayUnavailableError("404"); return { ...o }; }
  async findOrders(receipt: string) { return [...this.orders.values()].filter((o) => o.receipt === receipt); }
  async getPayment(id: string) { const p = this.payments.get(id); if (!p) throw new GatewayUnavailableError("404"); return { ...p }; }
  async getOrderPayments(order: string) { return [...this.payments.values()].filter((p) => p.orderId === order); }
  verifyPaymentSignature(order: string, payment: string, signature: string) { return this.real.verifyPaymentSignature(order, payment, signature); }
  verifyWebhookSignature(body: Buffer, signature: string) { return this.real.verifyWebhookSignature(body, signature); }
  parseWebhook(body: Buffer): GatewayEvent { return this.real.parseWebhook(body); }

  /** Customer completes Checkout: provider captures and returns the handler payload Checkout gives the browser. */
  capture(orderId: string) {
    const order = this.orders.get(orderId)!;
    const payment: GatewayPayment = { id: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`, orderId, amount: order.amount, currency: "INR", status: "captured", captured: true, amountRefunded: 0n, createdAt: new Date() };
    this.payments.set(payment.id, payment);
    order.status = "paid";
    return { razorpayOrderId: orderId, razorpayPaymentId: payment.id, razorpaySignature: createHmac("sha256", this.config.keySecret).update(`${orderId}|${payment.id}`).digest("hex") };
  }

  fail(orderId: string) {
    const order = this.orders.get(orderId)!;
    const payment: GatewayPayment = { id: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`, orderId, amount: order.amount, currency: "INR", status: "failed", captured: false, amountRefunded: 0n, createdAt: new Date() };
    this.payments.set(payment.id, payment);
    order.status = "attempted";
    return payment;
  }

  refund(paymentId: string) {
    const p = this.payments.get(paymentId)!;
    p.amountRefunded = p.amount; p.status = "refunded";
    return { id: `rfnd_${randomUUID().replace(/-/g, "").slice(0, 14)}`, paymentId, amount: p.amount, status: "processed" };
  }

  /** A webhook exactly as Razorpay would send it: raw JSON bytes plus their hex HMAC. */
  webhook(event: string, paymentId: string, refund?: { id: string; amount: bigint; status: string }) {
    const p = this.payments.get(paymentId)!;
    const payload: Record<string, unknown> = { payment: { entity: { id: p.id, order_id: p.orderId, amount: Number(p.amount), currency: p.currency, status: p.status, captured: p.captured,
      amount_refunded: Number(p.amountRefunded), created_at: Math.floor(p.createdAt.getTime() / 1000) } } };
    if (refund) payload.refund = { entity: { id: refund.id, payment_id: paymentId, amount: Number(refund.amount), status: refund.status } };
    // Deliberately unusual spacing: verification must use these exact bytes, not a re-serialization.
    const body = Buffer.from(`{"entity":"event",  "event":"${event}","payload":${JSON.stringify(payload)}}`);
    return { body, signature: createHmac("sha256", this.config.webhookSecret).update(body).digest("hex") };
  }
}
