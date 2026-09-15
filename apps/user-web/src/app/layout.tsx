import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@dhanvi/ui/globals.css";
import { AuthProvider } from "@dhanvi/auth";
import { ToastProvider, ConfirmProvider } from "@dhanvi/ui";
import { AppShell } from "@dhanvi/features/layout/app-shell";
import { userAuthConfig, userShell } from "@/shell/user-app";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const metadata: Metadata = {
  title: { default: "Dhanvi — Your Circle. Your Savings. Your Turn.", template: "%s | Dhanvi" },
  description: "Dhanvi organises community savings groups with transparent rules, verified organizers and auditable selection.",
};
export const viewport: Viewport = { themeColor: "#15803d", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} data-scroll-behavior="smooth">
      <body>
        <AuthProvider app={userAuthConfig}>
          <ToastProvider>
            <ConfirmProvider>
              <AppShell config={userShell}>{children}</AppShell>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
