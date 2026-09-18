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

// Member portal: personal, action-focused. Financial history (posted ledger lines) is reachable from Payments, not the nav.
const memberItems = (user: CurrentUser): NavItem[] => [
  { href: "/dashboard", label: "Home", icon: "Home" },
  { href: "/my-groups", label: "My groups", icon: "Users" },
  { href: "/groups", label: "Browse groups", icon: "Search", prefix: true },
  { href: "/contributions", label: "Contributions", icon: "Wallet" },
  { href: "/payments", label: "Payments", icon: "Activity", prefix: true },
  { href: "/payouts", label: "Payouts", icon: "Send", prefix: true },
  { href: "/profile", label: "Profile", icon: "User" },
  ...(user.organizerStatus === "APPROVED" ? [] : [{ href: user.organizerStatus === "NOT_APPLIED" ? "/become-organizer" : "/organizer/application-status", label: "Become an organizer", icon: "Briefcase" as IconName, prefix: true }]),
];

// Organizer: own-group operations only. "Create group" lives once, on the managed groups page.
const organizerItems: NavItem[] = [
  { href: "/organizer", label: "Organizer", icon: "Dashboard" },
  { href: "/organizer/groups", label: "My managed groups", icon: "Layers", prefix: true },
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

/**
 * Bottom navigation for phones: four destinations plus "More" (the shell adds it). Members get the money-first set; an
 * organizer swaps Payments for the Organizer hub so organizer tools stay one tap away without a second nav system —
 * every organizer section is still listed under its own heading in the drawer.
 */
function mobileNavigation(user: CurrentUser): NavItem[] {
  if (isOrganizerRole(user.roles)) return [
    { href: "/dashboard", label: "Home", icon: "Home" },
    { href: "/organizer", label: "Organizer", icon: "Briefcase", prefix: true },
    { href: "/my-groups", label: "My groups", icon: "Users" },
    { href: "/contributions", label: "Contributions", shortLabel: "Contribute", icon: "Wallet" },
  ];
  return [
    { href: "/dashboard", label: "Home", icon: "Home" },
    { href: "/my-groups", label: "My groups", icon: "Users" },
    { href: "/contributions", label: "Contributions", shortLabel: "Contribute", icon: "Wallet" },
    { href: "/payments", label: "Payments", icon: "Activity", prefix: true },
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
  [/^\/organizer\/groups\/[^/]+\/cycles\/[^/]+\/contributions/, "Cycle contributions"], [/^\/organizer\/groups\/[^/]+\/payouts/, "Group payouts"], [/^\/organizer\/groups\/[^/]+/, "My group"], [/^\/organizer\/groups/, "My managed groups"],
  [/^\/organizer\/applications/, "Applications"], [/^\/organizer\/application-status/, "Organizer application"], [/^\/organizer/, "Organizer"],
  [/^\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"], [/^\/groups\/[^/]+\/cycles\/[^/]+\/selection\/verify/, "Verify draw"], [/^\/groups\/[^/]+/, "Group"], [/^\/groups/, "Browse groups"],
  [/^\/my-groups/, "My groups"], [/^\/contributions/, "Contributions"], [/^\/profile/, "Profile"], [/^\/become-organizer/, "Become an organizer"], [/^\/dashboard/, "Home"],
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
