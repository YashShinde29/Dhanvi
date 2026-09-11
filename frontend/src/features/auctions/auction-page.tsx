"use client";
import { useParams } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { AuctionPanel } from "./auction-panel";
import { groupService, type GroupScope } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { Breadcrumbs } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/callout";
import { PageSkeleton } from "@/components/ui/skeleton";
import { GroupTypeBadge, StatusBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";

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
  const groupHref = `${management ? `/${scope}` : ""}/groups/${id}`;
  const crumbs = [{ label: scope === "organizer" ? "My groups" : scope === "admin" ? "Platform groups" : "My groups", href: scope === "organizer" ? "/organizer/groups" : scope === "admin" ? "/admin/groups" : "/my-groups" }, { label: data?.group.name ?? "Group", href: groupHref }, { label: data ? `Cycle ${data.cycle.cycleNumber}` : "Cycle", href: groupHref }, { label: "Auction" }];
  if (error) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data) return <PageSkeleton />;
  return (
    <div className="stack stack--lg">
      <div className="stack stack--sm">
        <Breadcrumbs items={crumbs} />
        <div className="page-header">
          <div className="page-header__text">
            <div className="row"><GroupTypeBadge type={data.group.groupType} /><StatusBadge kind="cycle" value={data.cycle.status} /></div>
            <h1 className="h-page">{data.group.name}</h1>
            <p className="page-header__desc">Cycle {data.cycle.cycleNumber} of {data.group.durationMonths} · Group value {formatMoney(data.group.groupValue)}</p>
          </div>
        </div>
      </div>
      <AuctionPanel group={data.group} cycle={data.cycle} scope={scope} />
    </div>
  );
}
