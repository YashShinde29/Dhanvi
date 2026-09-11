"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { OrganizerApplicationsQueue } from "@/features/organizers/applications-queue";

export default function AdminOrganizersPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><OrganizerApplicationsQueue /></ProtectedPage>;
}
