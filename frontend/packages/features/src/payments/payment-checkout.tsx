"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { paymentService } from "@dhanvi/api-client";
import { useAsyncData, formatDate, formatMoney } from "@dhanvi/utils";
import { Button, Badge, ConfirmDialog } from "@dhanvi/ui";
import type { CheckoutResult, Payment } from "@dhanvi/types";
import { paymentGuidance } from "../workflow/payment-workflow";

interface RazorpayCheckout {
  open(): void;
  on(event: "payment.failed", handler: () => void): void;
}
interface RazorpayOptions {
  key: string; order_id: string; amount: number; currency: string; name: string; description: string;
  notes: { DhanviPaymentId: string };
  handler: (response: CheckoutResult) => void; modal: { ondismiss: () => void };
}
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => RazorpayCheckout } }
let loader: Promise<void> | null = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!loader) loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true;
    script.onload = () => resolve(); script.onerror = () => { script.remove(); loader = null; reject(new Error("Checkout could not load. Please retry.")); };
    document.head.appendChild(script);
  });
  return loader;
}
export function PaymentCheckout({ contributionId, groupName, cycleNumber, dueDate }: { contributionId: string; groupName: string; cycleNumber: number; dueDate: string }) {
  const state = useAsyncData(() => paymentService.eligibility(contributionId), [contributionId]);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [message, setMessage] = useState("");
  const [lastPayment, setLastPayment] = useState<Payment | null>(null);
  const key = useRef<string | null>(null);
  const pending = state.data?.paymentId && state.data.financiallySettledAmount === 0;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(state.reload, 5000);
    return () => clearInterval(timer);
  }, [pending, state.reload]);
  async function refresh() {
    if (!state.data?.paymentId) return;
    setBusy(true);
    try { setLastPayment(await paymentService.refresh(state.data.paymentId)); setMessage(""); state.reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Status could not be checked. Your contribution has not been charged again."); }
    finally { setBusy(false); }
  }
  async function pay() {
    setBusy(true); setMessage("");
    try {
      if (state.data?.financialStatus === "Refunded" && !state.data.paymentId) key.current = null;
      key.current ??= crypto.randomUUID();
      const checkout = await paymentService.create(contributionId, key.current);
      if (!checkout.checkoutAllowed || !checkout.payment.providerOrderId) {
        setMessage("Payment is processing. Check its status before retrying."); state.reload(); setBusy(false); setConfirm(false); return;
      }
      if (!checkout.keyId.startsWith("rzp_test_")) throw new Error("Only Razorpay Test checkout is supported.");
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Checkout is unavailable.");
      const modal = new window.Razorpay({
        key: checkout.keyId, order_id: checkout.payment.providerOrderId, amount: checkout.amountInMinorUnits, currency: checkout.payment.currency,
        notes: { DhanviPaymentId: checkout.payment.id },
        name: "Dhanvi · Razorpay Test", description: `${groupName} · Cycle ${cycleNumber}`,
        handler: async (result) => {
          setMessage("Verifying payment…");
          try {
            const payment = await paymentService.verify(checkout.payment.id, result);
            setLastPayment(payment);
            setMessage(payment.settledAt && !payment.refundedAt ? "" : "Payment submitted — we're verifying it with Razorpay. No additional payment is required.");
          } catch { setMessage("We couldn't verify this payment yet. Your contribution has not been charged again — use Check status; Razorpay's confirmation can still settle it."); }
          finally { setBusy(false); state.reload(); }
        },
        modal: { ondismiss: () => { setBusy(false); setMessage("Checkout closed. Check payment status before retrying."); state.reload(); } },
      });
      modal.on("payment.failed", async () => {
        setMessage("Payment attempt failed. Checking whether your contribution was settled…");
        try {
          const current = await paymentService.refresh(checkout.payment.id);
          setLastPayment(current);
          setMessage(current.settledAt ? "" : current.status === "FAILED" ? "Payment failed — your contribution has not been settled and you were not charged. You can try again." : "Payment status is uncertain. Check status before retrying.");
        } catch { setMessage("Payment status is uncertain. Check status before retrying — your contribution has not been charged again."); }
        finally { setBusy(false); state.reload(); }
      });
      setConfirm(false); modal.open(); state.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Checkout could not open."); setBusy(false); state.reload(); }
  }
  if (state.error) return <div className="stack"><span role="alert">{state.error}</span><Button size="sm" variant="secondary" onClick={state.reload}>Reload payment status</Button></div>;
  if (!state.data) return <span className="text-muted">Checking payment eligibility…</span>;
  const s = state.data;
  const guide = paymentGuidance(s, lastPayment && lastPayment.id === s.paymentId ? lastPayment : null);
  const tone = guide.status === "complete" ? "success" : guide.status === "attention" ? "warning" : guide.status === "blocked" ? "danger" : guide.status === "waiting" ? "info" : "neutral";
  return <div className="stack pay-status" style={{ gap: 8 }} data-status={guide.status}>
    <div className="row" style={{ gap: 8 }}><Badge tone={tone}>{guide.title}</Badge><Badge tone="info" plain>Razorpay Test Mode</Badge></div>
    <span className="text-sm text-secondary">{guide.description}{guide.next && <> <strong>Next:</strong> {guide.next}</>}</span>
    {s.canPay && <span className="text-sm text-muted">Pay manually through Razorpay. No automatic deductions.</span>}
    {s.canPay ? <Button size="sm" disabled={busy} onClick={() => setConfirm(true)}>{guide.retry ? "Retry payment" : "Pay"} {formatMoney(s.remainingAmount)}</Button> : guide.status !== "complete" && s.reason ? <span className="text-sm text-muted">Reason: {s.reason}</span> : null}
    {s.paymentId && <div className="row"><Button size="sm" variant="secondary" loading={busy} onClick={refresh}>Check payment status</Button><Link className="link" href={`/payments/${s.paymentId}`}>Payment details</Link></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={pay} busy={busy} options={{
      title: `Pay ${formatMoney(s.remainingAmount)} for Cycle ${cycleNumber}`, confirmLabel: "Continue to Razorpay",
      description: `${groupName} · Due ${formatDate(dueDate)} · Razorpay Test Mode. No production money.`,
    }} />
  </div>;
}
