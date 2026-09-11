"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { ProfilePage } from "@/features/profile/profile-page";

export default function Page() {
  const auth = useAuth();
  return <ProtectedPage>{auth.user ? <ProfilePage key={auth.user.id} /> : null}</ProtectedPage>;
}
