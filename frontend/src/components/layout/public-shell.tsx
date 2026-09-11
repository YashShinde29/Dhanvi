"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth, postLoginPath } from "@/features/auth/auth-context";
import { LinkButton } from "@/components/ui/button";
import { Brand } from "./brand";

export function PublicHeader() {
  const auth = useAuth();
  return (
    <header className="public-header">
      <div className="public-header__inner">
        <Brand />
        <nav className="public-header__nav" aria-label="Public navigation">
          <Link href="/groups">Browse groups</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#organizers">For organizers</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <div className="public-header__actions">
          {auth.authenticated ? (
            <LinkButton href={postLoginPath(auth.roles)} size="sm">Go to dashboard</LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm">Sign in</LinkButton>
              <LinkButton href="/register" size="sm">Create account</LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__inner">
        <div className="public-footer__col">
          <Brand />
          <p style={{ marginTop: 8 }}>Your Circle. Your Savings. Your Turn.</p>
          <p className="text-xs text-muted">Dhanvi organises community savings groups with transparent rules and auditable records. Dhanvi does not offer investment returns.</p>
        </div>
        <div className="public-footer__col">
          <h4>Product</h4>
          <Link href="/groups">Browse groups</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#group-types">Group types</Link>
        </div>
        <div className="public-footer__col">
          <h4>Organizers</h4>
          <Link href="/#organizers">Organizer tools</Link>
          <Link href="/register">Create an account</Link>
          <Link href="/become-organizer">Apply as organizer</Link>
        </div>
        <div className="public-footer__col">
          <h4>Account</h4>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Register</Link>
          <Link href="/forgot-password">Reset password</Link>
        </div>
      </div>
      <div className="public-footer__bottom">
        <span>© {new Date().getFullYear()} Dhanvi</span>
        <span>Business time zone: Asia/Kolkata (IST)</span>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <PublicHeader />
      <main className="public-main">{children}</main>
      <PublicFooter />
    </div>
  );
}
