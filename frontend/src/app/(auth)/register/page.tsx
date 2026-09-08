"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/services/auth.service";
import { errorMessage, passwordError } from "@/utils/forms";

export default function RegisterPage() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phoneNumber: "", password: "", confirmPassword: "" });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const router = useRouter();
  const field = (name: keyof typeof form) => ({ value: form[name], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: e.target.value }) });
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const passwordProblem = passwordError(form.password);
    if (passwordProblem) return setError(passwordProblem);
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");
    setBusy(true);
    try { await authService.register(form); router.push("/login?registered=true"); } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  }
  return <section className="panel form-panel"><p className="eyebrow">Join Dhanvi</p><h1>Create your account</h1>
    <form onSubmit={submit} className="form-stack"><div className="form-grid">
      <label>First name<input required autoComplete="given-name" {...field("firstName")} /></label>
      <label>Last name<input required autoComplete="family-name" {...field("lastName")} /></label>
    </div>
      <label>Email<input required type="email" autoComplete="email" {...field("email")} /></label>
      <label>Phone number <span className="optional">(optional)</span><input autoComplete="tel" {...field("phoneNumber")} /></label>
      <label>Password<input required type="password" autoComplete="new-password" {...field("password")} /></label>
      <label>Confirm password<input required type="password" autoComplete="new-password" {...field("confirmPassword")} /></label>
      <p className="hint">At least 8 characters with uppercase, lowercase, number, and special character.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
    </form><div className="form-links"><Link href="/login">Already have an account?</Link></div>
  </section>;
}
