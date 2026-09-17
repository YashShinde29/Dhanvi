"use client";
import type { GroupScope } from "@dhanvi/api-client";
import { Guard } from "./shared";
import { MemberGroupDetail } from "./member-group-detail";
import { OrganizerGroupDetail } from "./organizer-group-detail";

/**
 * Member portal group pages. The public/mine scopes render the member view; the organizer scope renders the
 * organizer's own-group operations. Platform administration has its own page in the admin portal.
 */
export function GroupDetailPage({ scope = "public", applications = false }: { scope?: Exclude<GroupScope, "admin">; applications?: boolean }) {
  if (scope === "organizer") return <Guard scope="organizer"><OrganizerGroupDetail applications={applications} /></Guard>;
  return <MemberGroupDetail scope={scope} />;
}
