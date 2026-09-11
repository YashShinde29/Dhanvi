"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authService } from "@/services/auth.service";
import { AuthLayout } from "@/features/auth/auth-layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField, PasswordInput } from "@/components/ui/form";
import { PageSkeleton } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/errors";
import { PASSWORD_HINT, passwordError } from "@/utils/forms";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const next: typeof errors = {};
    const problem = passwordError(password);
    if (problem) next.password = problem;
    if (password !== confirm) next.confirm = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!token) { setError("This reset link is missing its token. Request a new link and try again."); return; }
    setBusy(true);
    try { setMessage((await authService.resetPassword(token, password)).message || "Your password has been reset."); }
    catch (failure) { setError(friendlyError(failure)); }
    finally { setBusy(false); }
  }
  if (message) {
    return (
      <AuthLayout title="Password reset" subtitle="You can now sign in with your new password.">
        <Callout variant="success" role="status">{message}</Callout>
        <LinkButton href="/login?reset=true" block size="lg">Sign in</LinkButton>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" subtitle="Pick a strong password you haven't used before." footer={<Link href="/login" className="link">← Back to sign in</Link>}>
      {!token && <Callout variant="warning">This page needs a reset link from your email. <Link href="/forgot-password" className="link">Request a new link</Link>.</Callout>}
      <form className="stack" onSubmit={submit} noValidate>
        <FormField label="New password" htmlFor="reset-password" required error={errors.password} help={PASSWORD_HINT}>
          <PasswordInput id="reset-password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} autoFocus />
        </FormField>
        <FormField label="Confirm password" htmlFor="reset-confirm" required error={errors.confirm}>
          <PasswordInput id="reset-confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirm} />
        </FormField>
        {error && <Callout variant="danger">{error}</Callout>}
        <Button type="submit" loading={busy} block size="lg">Reset password</Button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="page"><PageSkeleton /></div>}><ResetPasswordForm /></Suspense>;
}
