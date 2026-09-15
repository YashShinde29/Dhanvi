"use client";
import type { ReactNode } from "react";
import { env } from "@dhanvi/config";
import { ADMIN_ROLES, type AppAuthConfig } from "@dhanvi/auth";
import { Brand } from "@dhanvi/ui";
import { Forbidden } from "@dhanvi/features/auth/forbidden";
import { titleFromRules, type MenuItem, type NavItem, type NavSection, type ShellConfig } from "@dhanvi/features/layout/navigation";

export const HOME = "/dashboard";

/** Admin portal policy: only platform administrators. Everyone else sees the restriction screen, never admin content. */
export const adminAuthConfig: AppAuthConfig = {
  kind: "admin",
  allowedRoles: ADMIN_ROLES,
  homePath: HOME,
  loginPath: "/login",
  forbidden: <Forbidden message="You do not have permission to access the Dhanvi Admin Portal." altHref={env.userAppUrl} altLabel="Go to Dhanvi" />,
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "Dashboard" },
  { href: "/organizers", label: "Organizers", icon: "Inbox", prefix: true },
  { href: "/groups", label: "Groups", icon: "Layers", prefix: true },
  { href: "/payments", label: "Payments", icon: "Wallet", prefix: true },
  { href: "/payouts", label: "Payouts", icon: "Wallet", prefix: true },
  { href: "/ledger", label: "Ledger", icon: "Activity", prefix: true },
];

const navigation = (): NavSection[] => [
  { heading: "Operations", items },
  { heading: "Member app", items: [{ href: env.userAppUrl, label: "Go to Dhanvi", icon: "Users", external: true }] },
];

const mobileNavigation = (): NavItem[] => [items[0], items[1], items[2], items[3]];

const menuItems = (): MenuItem[] => [
  { href: "/profile", label: "Profile & security", icon: "User" },
  { href: env.userAppUrl, label: "Go to Dhanvi", icon: "Users", external: true },
];

const titles: [RegExp, string][] = [
  [/^\/payouts/, "Payout operations"], [/^\/payments/, "Payments"], [/^\/ledger\/trial-balance/, "Trial balance"], [/^\/ledger\/accounts/, "Chart of accounts"], [/^\/ledger/, "Financial ledger"],
  [/^\/organizers/, "Organizer applications"], [/^\/groups\/create/, "Create platform group"], [/^\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"],
  [/^\/groups\/[^/]+\/cycles\/[^/]+\/contributions/, "Cycle contributions"], [/^\/groups\/[^/]+/, "Group management"], [/^\/groups/, "Platform groups"],
  [/^\/profile/, "Profile"], [/^\/dashboard/, "Admin overview"],
];

/** The admin portal has no marketing site: anonymous visitors only ever see the sign-in page. */
function AdminPublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="public-header"><div className="public-header__inner"><Brand label="Dhanvi Admin" href="/login" /></div></header>
      <main className="public-main">{children}</main>
    </div>
  );
}

export const adminShell: ShellConfig = {
  brand: { label: "Dhanvi", subtitle: "Admin Portal" },
  publicRoutes: ["/login"],
  publicShell: (children) => <AdminPublicShell>{children}</AdminPublicShell>,
  homeHref: () => HOME,
  navigation,
  mobileNavigation,
  menuItems,
  pageTitle: (pathname) => titleFromRules(titles, pathname, "Dhanvi Admin"),
  loginPath: "/login",
};
