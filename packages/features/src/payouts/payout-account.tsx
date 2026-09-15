"use client";
import { useState, type FormEvent } from "react";
import { useAsyncData, formatDateTime } from "@dhanvi/utils";
import { payoutService } from "@dhanvi/api-client";
import { Card, CardBody, CardHeader, FormField, Input, PasswordInput, Button, Callout, useToast } from "@dhanvi/ui";
import type { PayoutAccountRequest } from "@dhanvi/types";
const empty: PayoutAccountRequest = { accountHolderName: "", accountNumber: "", confirmAccountNumber: "", ifsc: "", bankName: "", password: "" };
export function PayoutAccountForm() {
  const data = useAsyncData(payoutService.account, []), toast = useToast();
  const [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await payoutService.saveAccount(form); setForm(empty); data.reload(); toast.success("Payout account saved ✓", "Next: Dhanvi approves the destination for any pending payout after the 24-hour hold."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save account."); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader title="Payout account" subtitle="This account will be used for eligible payout transfers." /><CardBody className="stack">
    <Callout variant="info">Test payouts only. Use dummy account details. Account changes have a 24-hour hold; approved payouts retain their original destination.</Callout>
    {data.data && <p>Account ending {data.data.maskedAccountNumber} · {data.data.accountHolderName}<br /><span className="text-muted">Format validated; bank ownership is not verified. Available {formatDateTime(data.data.availableAt)}.</span></p>}
    {(error || data.error) && <Callout variant="danger">{error || data.error}</Callout>}
    <form className="stack" onSubmit={save} autoComplete="off"><div className="grid-2">
      {([['accountHolderName', 'Account holder name'], ['accountNumber', 'Account number'], ['confirmAccountNumber', 'Confirm account number'], ['ifsc', 'IFSC'], ['bankName', 'Bank name']] as const).map(([key, label]) => <FormField key={key} label={label} htmlFor={`payout-${key}`} required={key !== "bankName"}><Input id={`payout-${key}`} value={form[key]} required={key !== "bankName"} type={key.includes("AccountNumber") || key === "accountNumber" ? "password" : "text"} maxLength={key === "ifsc" ? 11 : key.toLowerCase().includes("number") ? 18 : 100} onChange={e => setForm({ ...form, [key]: key === "ifsc" ? e.target.value.toUpperCase() : e.target.value })} /></FormField>)}
      <FormField label="Confirm your password" htmlFor="payout-password" required><PasswordInput id="payout-password" autoComplete="current-password" value={form.password} required onChange={e => setForm({ ...form, password: e.target.value })} /></FormField>
    </div><Button type="submit" loading={busy}>Save payout account</Button></form>
  </CardBody></Card>;
}
