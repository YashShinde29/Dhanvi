"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authService } from "@/services/auth.service";
import { AuthLayout } from "@/features/auth/auth-layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField, Input } from "@/components/ui/form";
import { friendlyError } from "@/lib/errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setBusy(true);
    try { setMessage((await authService.forgotPassword(email.trim())).message || "If an account exists for this email, reset instructions have been sent."); }
    catch (failure) { setError(friendlyError(failure)); }
    finally { setBusy(false); }
  }
  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send reset instructions if an account exists."
      footer={<Link href="/login" className="link">← Back to sign in</Link>}>
      {message ? (
        <div className="stack">
          <Callout variant="success" role="status" title="Check your inbox">{message}</Callout>
          <LinkButton href="/login" variant="secondary">Return to sign in</LinkButton>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <FormField label="Email" htmlFor="forgot-email" required>
            <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </FormField>
          {error && <Callout variant="danger">{error}</Callout>}
          <Button type="submit" loading={busy} block size="lg">Send reset instructions</Button>
        </form>
      )}
    </AuthLayout>
  );
}
