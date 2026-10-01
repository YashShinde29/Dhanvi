"use client";
import { ProtectedPage, useAuth } from "@dhanvi/auth";
import { ProfilePage } from "@dhanvi/features/profile/profile-page";
export default function Page() {
  const auth = useAuth();
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}>{auth.user ? <ProfilePage key={auth.user.id} memberSections={false} /> : null}</ProtectedPage>;
}
