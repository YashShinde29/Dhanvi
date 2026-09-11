"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authService } from "@/services/auth.service";
import { AuthLayout } from "@/features/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { PageSkeleton } from "@/components/ui/skeleton";
import { fieldErrors, friendlyError } from "@/lib/errors";
import { PASSWORD_HINT, passwordError } from "@/utils/forms";

type Form = { firstName: string; lastName: string; email: string; phoneNumber: string; password: string; confirmPassword: string };

function RegisterForm() {
  const [form, setForm] = useState<Form>({ firstName: "", lastName: "", email: "", phoneNumber: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const organizerIntent = useSearchParams().get("intent") === "organizer";
  const set = (name: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [name]: e.target.value }); if (errors[name]) setErrors({ ...errors, [name]: undefined }); };

  function validate(): boolean {
    const next: Partial<Record<keyof Form, string>> = {};
    if (!form.firstName.trim()) next.firstName = "Enter your first name.";
    if (!form.lastName.trim()) next.lastName = "Enter your last name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = "Enter a valid email address.";
    const passwordProblem = passwordError(form.password);
    if (passwordProblem) next.password = passwordProblem;
    if (form.password !== form.confirmPassword) next.confirmPassword = "Passwords do not match.";
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) document.getElementById(`register-${first}`)?.focus();
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!validate()) return;
    setBusy(true);
    try {
      await authService.register({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phoneNumber: form.phoneNumber.trim() || undefined, password: form.password });
      router.push("/login?registered=true");
    } catch (failure) {
      const fields = fieldErrors(failure);
      if (Object.keys(fields).length) setErrors(fields as Partial<Record<keyof Form, string>>);
      else setError(friendlyError(failure));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle={organizerIntent ? "Create an account first — you can apply to become an organizer right after." : "Join Dhanvi to browse and apply to savings groups."}
      footer={<span className="text-muted">Already have an account? <Link href="/login" className="link">Sign in</Link></span>}>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="grid-2">
          <FormField label="First name" htmlFor="register-firstName" required error={errors.firstName}>
            <Input id="register-firstName" autoComplete="given-name" value={form.firstName} onChange={set("firstName")} invalid={!!errors.firstName} autoFocus />
          </FormField>
          <FormField label="Last name" htmlFor="register-lastName" required error={errors.lastName}>
            <Input id="register-lastName" autoComplete="family-name" value={form.lastName} onChange={set("lastName")} invalid={!!errors.lastName} />
          </FormField>
        </div>
        <FormField label="Email" htmlFor="register-email" required error={errors.email}>
          <Input id="register-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} invalid={!!errors.email} />
        </FormField>
        <FormField label="Phone number" htmlFor="register-phoneNumber" optional error={errors.phoneNumber} help="Used by organizers of groups you join, never shown publicly.">
          <Input id="register-phoneNumber" type="tel" autoComplete="tel" value={form.phoneNumber} onChange={set("phoneNumber")} invalid={!!errors.phoneNumber} />
        </FormField>
        <FormField label="Password" htmlFor="register-password" required error={errors.password} help={PASSWORD_HINT}>
          <PasswordInput id="register-password" autoComplete="new-password" value={form.password} onChange={set("password")} invalid={!!errors.password} />
        </FormField>
        <FormField label="Confirm password" htmlFor="register-confirmPassword" required error={errors.confirmPassword}>
          <PasswordInput id="register-confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} invalid={!!errors.confirmPassword} />
        </FormField>
        {error && <Callout variant="danger">{error}</Callout>}
        <Button type="submit" loading={busy} block size="lg">{busy ? "Creating account…" : "Create account"}</Button>
      </form>
    </AuthLayout>
  );
}

export default function RegisterPage() {
  return <Suspense fallback={<div className="page"><PageSkeleton /></div>}><RegisterForm /></Suspense>;
}
