"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";

export function AppHeader() {
  const auth = useAuth();
  const router = useRouter();
  const isAdmin = auth.roles.includes("ADMIN") || auth.roles.includes("SUPER_ADMIN");
  return (
    <header className="site-header">
      <Link className="brand" href="/">Dhanvi</Link>
      <nav className="nav" aria-label="Main navigation">
        {auth.authenticated && <Link href="/dashboard">Dashboard</Link>}
        {auth.authenticated && <Link href="/profile">Profile</Link>}
        {auth.authenticated && <Link href="/become-organizer">Become an organizer</Link>}
        {isAdmin && <Link href="/admin/organizers">Admin</Link>}
        {!auth.loading && !auth.authenticated && <Link href="/login">Sign in</Link>}
        {auth.authenticated && <button className="link-button" onClick={() => auth.logout().then(() => router.push("/login"))}>Sign out</button>}
      </nav>
    </header>
  );
}

