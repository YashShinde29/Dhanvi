"use client";

import { ProtectedPage } from "@/features/auth/protected-page";

export default function OrganizerPage() {
  return <ProtectedPage roles={["ORGANIZER"]}><section className="panel"><p className="eyebrow">Organizer</p><h1>Organizer workspace</h1><p>Your organizer access is active. Group administration tools will arrive in the next milestone.</p></section></ProtectedPage>;
}
