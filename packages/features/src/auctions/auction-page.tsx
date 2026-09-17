"use client";
import { useParams } from "next/navigation";
import { ProtectedPage } from "@dhanvi/auth";
import { groupService, type GroupScope, contributionService } from "@dhanvi/api-client";
import { useAsyncData } from "@dhanvi/utils";
import { Breadcrumbs, ErrorState, PageSkeleton } from "@dhanvi/ui";
import { AuctionExperience } from "./auction-experience";
import { AuctionOperations, OrganizerAuctionPage } from "./auction-operations";

/** Dedicated auction route in every app: members get the experience, operators get operations. */
export function AuctionPage({ scope = "public" }: { scope?: GroupScope }) {
  return <ProtectedPage roles={scope === "admin" ? ["ADMIN", "SUPER_ADMIN"] : scope === "organizer" ? ["ORGANIZER"] : undefined}><Content scope={scope} /></ProtectedPage>;
}

function Content({ scope }: { scope: GroupScope }) {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const management = scope === "admin" || scope === "organizer";
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [group, cycles] = await Promise.all([groupService.details(id, scope), contributionService.cycles(id, management ? (scope as "admin" | "organizer") : undefined)]);
    const cycle = cycles.find((c) => c.id === cycleId);
    if (!cycle) throw new Error("We couldn't find this cycle.");
    if (cycle.selectionMethod !== "AUCTION") throw new Error("This cycle does not use auction selection.");
    return { group, cycle };
  }, [id, cycleId, scope, management]);
  if (error) return <div className="stack"><Breadcrumbs items={[{ label: "Groups", href: scope === "organizer" ? "/organizer/groups" : scope === "admin" ? "/groups" : "/my-groups" }, { label: "Auction" }]} /><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data) return <PageSkeleton />;
  if (scope === "admin") return <AuctionOperations group={data.group} cycle={data.cycle} scope="admin" groupHref={`/groups/${id}`} listHref="/groups" listLabel="Groups" />;
  if (scope === "organizer") return <OrganizerAuctionPage group={data.group} cycle={data.cycle} />;
  return <AuctionExperience group={data.group} cycle={data.cycle} groupHref={`/groups/${id}`} payoutsHref="/payouts" />;
}
