import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/features/auth/auth-context";
import { ConfirmProvider } from "@/hooks/use-confirm";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dhanvi — Your Circle. Your Savings. Your Turn.", template: "%s | Dhanvi" },
  description: "Dhanvi organises community savings groups with transparent rules, verified organizers and auditable selection.",
};

export const viewport: Viewport = { themeColor: "#15803d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AppShell>{children}</AppShell>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
