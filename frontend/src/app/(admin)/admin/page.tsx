"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { AdminDashboard } from "@/features/dashboard/admin-dashboard";

export default function AdminPage() {
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><AdminDashboard /></ProtectedPage>;
}
