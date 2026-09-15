"use client";
import { ProtectedPage } from "@dhanvi/auth";
import { AdminDashboard } from "@dhanvi/features/dashboard/admin-dashboard";

export default function AdminPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><AdminDashboard /></ProtectedPage>;
}
