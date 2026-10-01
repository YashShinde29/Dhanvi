"use client";
import { ProtectedPage } from "@dhanvi/auth";
import { UserDashboard } from "@dhanvi/features/dashboard/user-dashboard";

export default function DashboardPage() {
  return <ProtectedPage><UserDashboard /></ProtectedPage>;
}
