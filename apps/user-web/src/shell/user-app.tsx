"use client";
import type { ReactNode } from "react";
import { env } from "@dhanvi/config";
import { USER_APP_ROLES, isAdminRole, isOrganizerRole, type AppAuthConfig } from "@dhanvi/auth";
import type { CurrentUser } from "@dhanvi/types";
import type { IconName } from "@dhanvi/ui";
import { Forbidden } from "@dhanvi/features/auth/forbidden";
import { PublicShell } from "@dhanvi/features/layout/public-shell";
import { titleFromRules, type MenuItem, type NavItem, type NavSection, type ShellConfig } from "@dhanvi/features/layout/navigation";

export const HOME = "/dashboard";

/** Member app policy: members and organizers. Administrators hold USER too, so they can use member features here. */
export const userAuthConfig: AppAuthConfig = {
  kind: "user",
  allowedRoles: USER_APP_ROLES,
  homePath: HOME,
  loginPath: "/login",
  forbidden: <Forbidden message="This account cannot use the Dhanvi member app." altHref={env.adminAppUrl} altLabel="Open Admin Portal" />,
};

const memberItems = (user: CurrentUser): NavItem[] => [
  { href: "/dashboard", label: "Dashboard", icon: "Dashboard" },
  { href: "/groups", label: "Browse groups", icon: "Search", prefix: true },
  { href: "/my-groups", label: "My groups", icon: "Users" },
  { href: "/contributions", label: "Contributions", icon: "Wallet" },
  { href: "/payments", label: "Payments", icon: "Wallet", prefix: true },
  { href: "/payouts", label: "Payouts", icon: "Wallet", prefix: true },
  { href: "/ledger", label: "Financial history", icon: "Activity" },
  { href: "/profile", label: "Profile", icon: "User" },
  ...(user.organizerStatus === "APPROVED" ? [] : [{ href: user.organizerStatus === "NOT_APPLIED" ? "/become-organizer" : "/organizer/application-status", label: "Become an organizer", icon: "Briefcase" as IconName, prefix: true }]),
];

const organizerItems: NavItem[] = [
  { href: "/organizer", label: "Organizer dashboard", icon: "Dashboard" },
  { href: "/organizer/groups", label: "Manage groups", icon: "Layers", prefix: true, exclude: ["/organizer/groups/create"] },
  { href: "/organizer/groups/create", label: "Create group", icon: "Plus" },
  { href: "/organizer/applications", label: "Applications", icon: "Inbox" },
];

const adminPortalItem: NavItem = { href: `${env.adminAppUrl}/dashboard`, label: "Open Admin Portal", icon: "ShieldCheck", external: true };

function navigation(user: CurrentUser): NavSection[] {
  const sections: NavSection[] = [];
  if (isOrganizerRole(user.roles)) sections.push({ heading: "Organizer", items: organizerItems });
  sections.push({ heading: "Member", items: memberItems(user) });
  // Platform administration lives in the separate admin portal; only a cross-link appears here.
  if (isAdminRole(user.roles)) sections.push({ heading: "Administration", items: [adminPortalItem] });
  return sections;
}

/** Bottom navigation for phones: the four most useful destinations per role. */
function mobileNavigation(user: CurrentUser): NavItem[] {
  if (isOrganizerRole(user.roles)) return [
    { href: "/organizer", label: "Dashboard", icon: "Dashboard" },
    { href: "/organizer/groups", label: "My groups", icon: "Layers", prefix: true },
    { href: "/organizer/applications", label: "Applications", icon: "Inbox" },
    { href: "/profile", label: "Profile", icon: "User" },
  ];
  return [
    { href: "/dashboard", label: "Home", icon: "Dashboard" },
    { href: "/groups", label: "Browse", icon: "Search", prefix: true },
    { href: "/my-groups", label: "My groups", icon: "Users" },
    { href: "/contributions", label: "Contributions", icon: "Wallet" },
  ];
}

function menuItems(user: CurrentUser): MenuItem[] {
  const items: MenuItem[] = [{ href: "/profile", label: "Profile & security", icon: "User" }];
  if (user.organizerStatus !== "APPROVED") items.push({ href: user.organizerStatus === "NOT_APPLIED" ? "/become-organizer" : "/organizer/application-status", label: "Organizer program", icon: "Briefcase" });
  if (isAdminRole(user.roles)) items.push({ href: `${env.adminAppUrl}/dashboard`, label: "Open Admin Portal", icon: "ShieldCheck", external: true });
  return items;
}

const titles: [RegExp, string][] = [
  [/^\/payouts/, "My payouts"], [/^\/payments/, "My payments"], [/^\/ledger/, "Financial history"],
  [/^\/organizer\/groups\/create/, "Create group"], [/^\/organizer\/groups\/[^/]+\/applications/, "Applications"], [/^\/organizer\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"],
  [/^\/organizer\/groups\/[^/]+\/cycles\/[^/]+\/contributions/, "Cycle contributions"], [/^\/organizer\/groups\/[^/]+\/payouts/, "Group payouts"], [/^\/organizer\/groups\/[^/]+/, "Group management"], [/^\/organizer\/groups/, "My groups"],
  [/^\/organizer\/applications/, "Applications"], [/^\/organizer\/application-status/, "Organizer application"], [/^\/organizer/, "Organizer dashboard"],
  [/^\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"], [/^\/groups\/[^/]+\/cycles\/[^/]+\/selection\/verify/, "Verify draw"], [/^\/groups\/[^/]+/, "Group details"], [/^\/groups/, "Browse groups"],
  [/^\/my-groups/, "My groups"], [/^\/contributions/, "Contributions"], [/^\/profile/, "Profile"], [/^\/become-organizer/, "Become an organizer"], [/^\/dashboard/, "Dashboard"],
];

export const userShell: ShellConfig = {
  brand: { label: "Dhanvi" },
  publicRoutes: ["/", "/login", "/register", "/forgot-password", "/reset-password"],
  publicShell: (children: ReactNode) => <PublicShell dashboardHref={HOME}>{children}</PublicShell>,
  homeHref: (user) => (isOrganizerRole(user.roles) ? "/organizer" : HOME),
  navigation,
  mobileNavigation,
  menuItems,
  pageTitle: (pathname) => titleFromRules(titles, pathname, "Dhanvi"),
  loginPath: "/login",
};
