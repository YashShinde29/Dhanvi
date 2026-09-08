"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authService } from "@/services/auth.service";
import { errorMessage, passwordError } from "@/utils/forms";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); const problem = passwordError(password); if (problem) return setError(problem); if (password !== confirm) return setError("Passwords do not match."); if (!token) return setError("Reset token is missing."); try { setMessage((await authService.resetPassword(token, password)).message); } catch (failure) { setError(errorMessage(failure)); } }
  if (message) return <section className="panel"><h1>Password reset</h1><p>{message}</p><Link className="button" href="/login">Sign in</Link></section>;
  return <section className="panel form-panel"><p className="eyebrow">Account recovery</p><h1>Choose a new password</h1><form className="form-stack" onSubmit={submit}>
    <label>New password<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label>Confirm password<input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
    {error && <p className="form-error">{error}</p>}<button className="button">Reset password</button></form></section>;
}

export default function ResetPasswordPage() { return <Suspense fallback={<p>Loading…</p>}><ResetPasswordForm /></Suspense>; }
