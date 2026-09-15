"use client";
import { ProtectedPage } from "@dhanvi/auth";
import { OrganizerDashboard } from "@dhanvi/features/dashboard/organizer-dashboard";

export default function OrganizerPage() {
  return <ProtectedPage roles={["ORGANIZER"]}><OrganizerDashboard /></ProtectedPage>;
}
