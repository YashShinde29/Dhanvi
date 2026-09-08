"use client";

import Link from "next/link";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";

export default function DashboardPage() {
  const { user } = useAuth();
  return <ProtectedPage><section>
    <p className="eyebrow">Member dashboard</p>
    <h1>Welcome, {user?.firstName}</h1>
    <p className="lead">Your Dhanvi account is ready. Savings groups and activity will arrive in a future milestone.</p>
    <div className="card-grid">
      <article className="panel compact"><h2>Your profile</h2><p>Keep your contact details and password current.</p><Link className="text-link" href="/profile">Manage profile</Link></article>
      <article className="panel compact"><h2>Organizer access</h2><p>Apply to organize savings groups and track the review.</p><Link className="text-link" href="/become-organizer">View organizer application</Link></article>
    </div>
  </section></ProtectedPage>;
}
