"use client";

import Link from "next/link";
import { ProtectedPage } from "@/features/auth/protected-page";

export default function AdminPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><section><p className="eyebrow">Administration</p><h1>Platform operations</h1><div className="panel compact"><h2>Organizer applications</h2><p>Review pending applications and record approval decisions.</p><Link className="button" href="/admin/organizers">Open review queue</Link></div></section></ProtectedPage>;
}
