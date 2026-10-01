import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@dhanvi/ui/globals.css";
import { AuthProvider } from "@dhanvi/auth";
import { ToastProvider, ConfirmProvider } from "@dhanvi/ui";
import { AppShell } from "@dhanvi/features/layout/app-shell";
import { adminAuthConfig, adminShell } from "@/shell/admin-app";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const metadata: Metadata = {
  title: { default: "Dhanvi Admin Control Center", template: "%s | Dhanvi Admin" },
  description: "Platform operations for Dhanvi: group tracking, organizer approval, payments, payouts, reconciliation and the financial ledger.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#15803d", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} data-scroll-behavior="smooth" data-app="admin">
      <body>
        <AuthProvider app={adminAuthConfig}>
          <ToastProvider>
            <ConfirmProvider>
              <AppShell config={adminShell}>{children}</AppShell>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
