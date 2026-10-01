import type { IconName } from "@dhanvi/ui";
import type { CurrentUser } from "@dhanvi/types";
import type { ReactNode } from "react";

export interface NavItem { href: string; label: string; /** Bottom-nav label when the full one cannot fit a 64px column (≤ 10 characters). */ shortLabel?: string; icon: IconName; /** Match nested routes too. */ prefix?: boolean; exclude?: string[]; /** Absolute link to the other Dhanvi app. */ external?: boolean }
export interface NavSection { heading: string; items: NavItem[] }
export interface MenuItem { href: string; label: string; icon: IconName; external?: boolean }

/** Everything an application needs to render its shell. Each app provides one of these. */
export interface ShellConfig {
  brand: { label: string; subtitle?: string };
  /** Routes that always render the public shell (marketing/auth). */
  publicRoutes: string[];
  /** Shell for anonymous visitors and public routes. */
  publicShell: (children: ReactNode) => ReactNode;
  homeHref: (user: CurrentUser) => string;
  navigation: (user: CurrentUser) => NavSection[];
  mobileNavigation: (user: CurrentUser) => NavItem[];
  menuItems: (user: CurrentUser) => MenuItem[];
  pageTitle: (pathname: string) => string;
  loginPath: string;
}

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.external) return false;
  if (item.exclude?.some((path) => pathname.startsWith(path))) return false;
  return item.prefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href;
}

/** Human page context for the top header, derived from ordered pathname rules. */
export function titleFromRules(rules: [RegExp, string][], pathname: string, fallback: string): string {
  return rules.find(([pattern]) => pattern.test(pathname))?.[1] ?? fallback;
}
