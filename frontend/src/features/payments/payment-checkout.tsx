"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { paymentService } from "@/services/payment.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { formatDate, formatMoney } from "@/lib/format";
import type { CheckoutResult } from "@/types/payment";

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
    try { await paymentService.refresh(state.data.paymentId); state.reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Status could not be checked."); }
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
            setMessage(payment.settledAt && !payment.refundedAt ? "Gateway settled · Razorpay Test Mode" : "Processing — waiting for a verified capture. Please do not pay again.");
          } catch { setMessage("Verification is pending. Check payment status; the webhook can still confirm it."); }
          finally { setBusy(false); state.reload(); }
        },
        modal: { ondismiss: () => { setBusy(false); setMessage("Checkout closed. Check payment status before retrying."); state.reload(); } },
      });
      modal.on("payment.failed", async () => {
        setMessage("Payment attempt failed. Checking whether your contribution was settled…");
        try {
          const current = await paymentService.refresh(checkout.payment.id);
          setMessage(current.settledAt ? "Gateway settled · Razorpay Test Mode" : current.status === "FAILED" ? "Your contribution was not settled. You can try again using the same order." : "Payment status is uncertain. Check status before retrying.");
        } catch { setMessage("Payment status is uncertain. Check status before retrying."); }
        finally { setBusy(false); state.reload(); }
      });
      setConfirm(false); modal.open(); state.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Checkout could not open."); setBusy(false); state.reload(); }
  }
  if (state.error) return <div className="stack"><span role="alert">{state.error}</span><Button size="sm" variant="secondary" onClick={state.reload}>Reload payment status</Button></div>;
  if (!state.data) return <span className="text-muted">Checking payment eligibility…</span>;
  const s = state.data;
  return <div className="stack" style={{ gap: 8 }}>
    <Badge tone="info">Razorpay Test Mode</Badge>
    <span>Gateway settled: {formatMoney(s.financiallySettledAmount)} · {s.financialStatus}</span>
    {s.canPay ? <Button size="sm" disabled={busy} onClick={() => setConfirm(true)}>Pay {formatMoney(s.remainingAmount)}</Button> : <span className="text-sm text-muted">{s.reason}</span>}
    {s.paymentId && <div className="row"><Button size="sm" variant="secondary" loading={busy} onClick={refresh}>Check status</Button><Link className="link" href={`/payments/${s.paymentId}`}>Payment details</Link></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={pay} busy={busy} options={{
      title: `Pay ${formatMoney(s.remainingAmount)} for Cycle ${cycleNumber}`, confirmLabel: "Continue to Razorpay",
      description: `${groupName} · Due ${formatDate(dueDate)} · Razorpay Test Mode. No production money.`,
    }} />
  </div>;
}
