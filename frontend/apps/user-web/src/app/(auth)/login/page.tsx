"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "@dhanvi/features/auth/login-form";
import { PageSkeleton } from "@dhanvi/ui";

function MemberLogin() {
  const searchParams = useSearchParams();
  const notice = searchParams.get("registered") === "true" ? "Your account was created. Sign in to continue."
    : searchParams.get("passwordChanged") === "true" ? "Your password was changed. Please sign in again."
    : searchParams.get("reset") === "true" ? "Your password has been reset. Sign in with your new password." : "";
  return (
    <LoginForm title="Welcome back" subtitle="Sign in to your Dhanvi account." notice={notice}
      footer={<><Link href="/forgot-password" className="link">Forgot password?</Link><span className="text-muted">New to Dhanvi? <Link href="/register" className="link">Create an account</Link></span></>} />
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="page"><PageSkeleton /></div>}><MemberLogin /></Suspense>;
}
