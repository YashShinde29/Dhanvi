"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { OrganizerDashboard } from "@/features/dashboard/organizer-dashboard";

export default function OrganizerPage() {
  return <ProtectedPage roles={["ORGANIZER"]}><OrganizerDashboard /></ProtectedPage>;
}
