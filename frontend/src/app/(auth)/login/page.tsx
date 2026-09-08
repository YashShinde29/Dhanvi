"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { postLoginPath, useAuth } from "@/features/auth/auth-context";
import { errorMessage } from "@/utils/forms";

function LoginForm() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const auth = useAuth(); const router = useRouter(); const searchParams = useSearchParams();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const user = await auth.login(email, password);
      const returnUrl = searchParams.get("returnUrl");
      router.push(returnUrl?.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : postLoginPath(user.roles));
    }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel form-panel"><p className="eyebrow">Account</p><h1>Sign in</h1>
    {searchParams.get("registered") === "true" && <p className="form-success" role="status">Your account was created. Sign in to continue.</p>}
    {searchParams.get("passwordChanged") === "true" && <p className="form-success" role="status">Your password was changed. Please sign in again.</p>}
    <form onSubmit={submit} className="form-stack">
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <div className="form-links"><Link href="/forgot-password">Forgot password?</Link><Link href="/register">Create an account</Link></div>
  </section>;
}

export default function LoginPage() { return <Suspense fallback={<p>Loading...</p>}><LoginForm /></Suspense>; }
