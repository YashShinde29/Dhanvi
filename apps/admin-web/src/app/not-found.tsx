import Link from "next/link";
export default function NotFound() {
  return <div className="forbidden"><h1>Page not found</h1><p className="text-secondary">Member features live in the Dhanvi app, not the admin portal.</p><Link className="btn btn--primary" href="/dashboard">Admin dashboard</Link></div>;
}
