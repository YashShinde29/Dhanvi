"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeReturnUrl, useAuth } from "@dhanvi/auth";
import { ApiError } from "@dhanvi/api-client";
import { friendlyError } from "@dhanvi/utils";
import { Button, Callout, FormField, Input, PasswordInput } from "@dhanvi/ui";
import { AuthLayout } from "./auth-layout";

/**
 * Sign-in form shared by the member app and the admin portal. Where the person lands afterwards is decided by
 * the app's auth policy: a permitted account goes home (or to a safe returnUrl); an account that may not use this
 * app reaches the app's forbidden screen instead of any protected content.
 */
export function LoginForm({ title, subtitle, footer, notice }: { title: string; subtitle?: ReactNode; footer?: ReactNode; notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeReturnUrl(searchParams.get("returnUrl"), auth.app.homePath);

  // The session cookie is shared by both apps on this host: an already signed-in, permitted account skips the form.
  useEffect(() => { if (!auth.loading && auth.permitted) router.replace(destination); }, [auth.loading, auth.permitted, destination, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await auth.login(email.trim(), password);
      router.push(destination);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? "The email or password you entered is incorrect." : friendlyError(failure));
      setBusy(false);
    }
  }
  return (
    <AuthLayout title={title} subtitle={subtitle} footer={footer}>
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
