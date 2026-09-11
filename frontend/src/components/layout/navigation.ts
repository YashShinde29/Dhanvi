import type { IconName } from "@/components/ui/icons";
import type { CurrentUser, PlatformRole } from "@/types/auth";

export interface NavItem { href: string; label: string; icon: IconName; /** Match nested routes too. */ prefix?: boolean; exclude?: string[] }
export interface NavSection { heading: string; items: NavItem[] }

export const isAdminRole = (roles: PlatformRole[]) => roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
export const isOrganizerRole = (roles: PlatformRole[]) => roles.includes("ORGANIZER");

export function primaryRoleLabel(user: CurrentUser | null): string {
  if (!user) return "";
  if (user.roles.includes("SUPER_ADMIN")) return "Super admin";
  if (user.roles.includes("ADMIN")) return "Administrator";
  if (user.roles.includes("ORGANIZER")) return "Organizer";
  return "Member";
}

const memberItems = (user: CurrentUser): NavItem[] => [
  { href: "/dashboard", label: "Dashboard", icon: "Dashboard" },
  { href: "/groups", label: "Browse groups", icon: "Search", prefix: true },
  { href: "/my-groups", label: "My groups", icon: "Users" },
  { href: "/contributions", label: "Contributions", icon: "Wallet" },
  { href: "/profile", label: "Profile", icon: "User" },
  ...(user.organizerStatus === "APPROVED" ? [] : [{ href: user.organizerStatus === "NOT_APPLIED" ? "/become-organizer" : "/organizer/application-status", label: "Become an organizer", icon: "Briefcase" as IconName, prefix: true }]),
];

export function navigationFor(user: CurrentUser | null): NavSection[] {
  if (!user) return [];
  const admin = isAdminRole(user.roles);
  const organizer = isOrganizerRole(user.roles);
  const sections: NavSection[] = [];
  if (admin) {
    sections.push({
      heading: "Administration",
      items: [
        { href: "/admin", label: "Overview", icon: "Dashboard" },
        { href: "/admin/organizers", label: "Organizer applications", icon: "Inbox", prefix: true },
        { href: "/admin/groups", label: "Groups", icon: "Layers", prefix: true },
      ],
    });
    sections.push({
      heading: "Account",
      items: [
        { href: "/groups", label: "Browse groups", icon: "Search", prefix: true },
        { href: "/profile", label: "Profile", icon: "User" },
      ],
    });
    return sections;
  }
  if (organizer) {
    sections.push({
      heading: "Organizer",
      items: [
        { href: "/organizer", label: "Dashboard", icon: "Dashboard" },
        { href: "/organizer/groups", label: "My groups", icon: "Layers", prefix: true, exclude: ["/organizer/groups/create"] },
        { href: "/organizer/groups/create", label: "Create group", icon: "Plus" },
        { href: "/organizer/applications", label: "Applications", icon: "Inbox" },
      ],
    });
    sections.push({ heading: "Member", items: memberItems(user) });
    return sections;
  }
  sections.push({ heading: "Member", items: memberItems(user) });
  return sections;
}

/** Bottom navigation for phones: the four most useful destinations per role. */
export function mobileNavigationFor(user: CurrentUser | null): NavItem[] {
  if (!user) return [];
  if (isAdminRole(user.roles)) return [
    { href: "/admin", label: "Overview", icon: "Dashboard" },
    { href: "/admin/organizers", label: "Applications", icon: "Inbox", prefix: true },
    { href: "/admin/groups", label: "Groups", icon: "Layers", prefix: true },
    { href: "/profile", label: "Profile", icon: "User" },
  ];
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

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exclude?.some((path) => pathname.startsWith(path))) return false;
  return item.prefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href;
}

/** Human page context for the top header, derived from the pathname. */
export function pageTitleFor(pathname: string): string {
  const rules: [RegExp, string][] = [
    [/^\/admin\/organizers/, "Organizer applications"], [/^\/admin\/groups\/create/, "Create platform group"], [/^\/admin\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"],
    [/^\/admin\/groups\/[^/]+\/cycles\/[^/]+\/contributions/, "Cycle contributions"], [/^\/admin\/groups\/[^/]+/, "Group management"], [/^\/admin\/groups/, "Platform groups"], [/^\/admin/, "Admin overview"],
    [/^\/organizer\/groups\/create/, "Create group"], [/^\/organizer\/groups\/[^/]+\/applications/, "Applications"], [/^\/organizer\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"],
    [/^\/organizer\/groups\/[^/]+\/cycles\/[^/]+\/contributions/, "Cycle contributions"], [/^\/organizer\/groups\/[^/]+/, "Group management"], [/^\/organizer\/groups/, "My groups"],
    [/^\/organizer\/applications/, "Applications"], [/^\/organizer\/application-status/, "Organizer application"], [/^\/organizer/, "Organizer dashboard"],
    [/^\/groups\/[^/]+\/cycles\/[^/]+\/auction/, "Auction"], [/^\/groups\/[^/]+\/cycles\/[^/]+\/selection\/verify/, "Verify draw"], [/^\/groups\/[^/]+/, "Group details"], [/^\/groups/, "Browse groups"],
    [/^\/my-groups/, "My groups"], [/^\/contributions/, "Contributions"], [/^\/profile/, "Profile"], [/^\/become-organizer/, "Become an organizer"], [/^\/dashboard/, "Dashboard"],
  ];
  return rules.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Dhanvi";
}
