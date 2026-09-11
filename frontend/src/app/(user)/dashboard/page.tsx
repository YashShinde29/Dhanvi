"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { UserDashboard } from "@/features/dashboard/user-dashboard";

export default function DashboardPage() {
  return <ProtectedPage><UserDashboard /></ProtectedPage>;
}
