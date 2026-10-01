"use client";
import { useRouter } from "next/navigation";
import { useAuth } from "@dhanvi/auth";
import { Button, Card, CardBody, Icons } from "@dhanvi/ui";

/** Shown when a signed-in account is not allowed to use the current application. No app content renders behind it. */
export function Forbidden({ message, altHref, altLabel }: { message: string; altHref: string; altLabel: string }) {
  const auth = useAuth();
  const router = useRouter();
  async function signOut() { await auth.logout(); router.push(auth.app.loginPath); }
  return (
    <div className="forbidden">
      <Card><CardBody className="stack" style={{ alignItems: "center", gap: 16 }}>
        <Icons.ShieldCheck size={32} />
        <h1 style={{ margin: 0 }}>Access restricted</h1>
        <p role="alert" className="text-secondary">{message}</p>
        {auth.user && <p className="text-sm text-muted">Signed in as {auth.user.email}</p>}
        <div className="row" style={{ justifyContent: "center" }}>
          <a className="btn btn--primary" href={altHref}>{altLabel}</a>
          <Button variant="secondary" onClick={signOut}>Sign out</Button>
        </div>
      </CardBody></Card>
    </div>
  );
}
