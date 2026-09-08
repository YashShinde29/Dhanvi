import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { AuthProvider } from "@/features/auth/auth-context";

export const metadata: Metadata = {
  title: { default: "Dhanvi", template: "%s | Dhanvi" },
  description: "A trustworthy foundation for community savings.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="shell">
            <AppHeader />
            <main className="content">{children}</main>
            <footer className="site-footer">Dhanvi · Built for transparent community savings</footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
