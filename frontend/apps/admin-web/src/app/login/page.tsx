"use client";

import { Suspense } from "react";
import { env } from "@dhanvi/config";
import { LoginForm } from "@dhanvi/features/auth/login-form";
import { PageSkeleton } from "@dhanvi/ui";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="page"><PageSkeleton /></div>}>
      <LoginForm title="Dhanvi Admin Portal" subtitle="Sign in with your administrator account. Platform operations only."
        footer={<><a href={`${env.userAppUrl}/forgot-password`} className="link">Forgot password?</a><a href={env.userAppUrl} className="link">Go to Dhanvi</a></>} />
    </Suspense>
  );
}
