"use client";
import { ProtectedPage } from "@dhanvi/auth";
import { OrganizerApplicationsQueue } from "@dhanvi/features/organizers/applications-queue";

export default function AdminOrganizersPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><OrganizerApplicationsQueue /></ProtectedPage>;
}
