"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { postLoginPath, useAuth } from "@/features/auth/auth-context";
import { AuthLayout } from "@/features/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { friendlyError } from "@/lib/errors";
import { ApiError } from "@/services/api-client";
import { PageSkeleton } from "@/components/ui/skeleton";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const notice = searchParams.get("registered") === "true" ? "Your account was created. Sign in to continue."
    : searchParams.get("passwordChanged") === "true" ? "Your password was changed. Please sign in again."
    : searchParams.get("reset") === "true" ? "Your password has been reset. Sign in with your new password." : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const user = await auth.login(email.trim(), password);
      const returnUrl = searchParams.get("returnUrl");
      router.push(returnUrl?.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : postLoginPath(user.roles));
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? "The email or password you entered is incorrect." : friendlyError(failure));
      setBusy(false);
    }
  }
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Dhanvi account."
      footer={<><Link href="/forgot-password" className="link">Forgot password?</Link><span className="text-muted">New to Dhanvi? <Link href="/register" className="link">Create an account</Link></span></>}>
      {notice && <Callout variant="success" role="status">{notice}</Callout>}
      <form onSubmit={submit} className="stack" noValidate>
        <FormField label="Email" htmlFor="login-email" required>
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@example.com" />
        </FormField>
        <FormField label="Password" htmlFor="login-password" required>
          <PasswordInput id="login-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        {error && <Callout variant="danger">{error}</Callout>}
        <Button type="submit" loading={busy} block size="lg">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="page"><PageSkeleton /></div>}><LoginForm /></Suspense>;
}
