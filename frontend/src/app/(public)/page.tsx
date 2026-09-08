import Link from "next/link";

export default function LandingPage() {
  return (
    <section className="hero">
      <p className="eyebrow">Save together. Grow with confidence.</p>
      <h1>A calmer, clearer way to build savings together.</h1>
      <p className="lead">Dhanvi is laying the groundwork for secure, transparent community savings with clear records and dependable workflows.</p>
      <div className="actions">
        <Link className="button" href="/register">Create an account</Link>
        <Link className="button secondary" href="/login">Sign in</Link>
      </div>
    </section>
  );
}

