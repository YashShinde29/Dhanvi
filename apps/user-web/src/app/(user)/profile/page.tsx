"use client";
import { ProtectedPage, useAuth } from "@dhanvi/auth";
import { ProfilePage } from "@dhanvi/features/profile/profile-page";
import { PayoutAccountForm } from "@dhanvi/features/payouts/payout-account";

export default function Page() {
  const auth = useAuth();
  return <ProtectedPage>{auth.user ? <ProfilePage key={auth.user.id} extras={<PayoutAccountForm />} /> : null}</ProtectedPage>;
}
