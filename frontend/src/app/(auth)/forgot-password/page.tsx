"use client";

import { FormEvent, useState } from "react";
import { authService } from "@/services/auth.service";
import { errorMessage } from "@/utils/forms";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { setMessage((await authService.forgotPassword(email)).message); } catch (failure) { setError(errorMessage(failure)); } }
  return <section className="panel form-panel"><p className="eyebrow">Account recovery</p><h1>Forgot password</h1><p>Enter your email and we’ll send reset instructions when an account exists.</p>
    <form className="form-stack" onSubmit={submit}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      {message && <p className="form-success">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="button">Send instructions</button></form>
  </section>;
}

