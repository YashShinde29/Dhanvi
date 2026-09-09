"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { AuctionPanel } from "./auction-panel";
import { errorText } from "@/features/groups/shared";
import { groupService, type GroupScope } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";

export function AuctionPage({ scope = "public" }: { scope?: GroupScope }) {
  return <ProtectedPage><Content scope={scope} /></ProtectedPage>;
}
function Content({ scope }: { scope: GroupScope }) {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const [data, setData] = useState<{ group: Group; cycle: MonthlyCycle }>();
  const [error, setError] = useState("");
  const management = scope === "admin" || scope === "organizer";
  useEffect(() => {
    let active = true;
    Promise.all([groupService.details(id, scope), contributionService.cycles(id, management ? scope : undefined)])
      .then(([group, cycles]) => {
        const cycle = cycles.find((c) => c.id === cycleId);
        if (!cycle || cycle.selectionMethod !== "AUCTION") throw new Error("This cycle does not use auction selection.");
        if (active) setData({ group, cycle });
      }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [id, cycleId, scope, management]);
  return <>
    <Link className="text-link" href={`/${management ? scope + "/" : ""}groups/${id}`}>Back to group</Link>
    <h1>Auction</h1>
    {error && <p role="alert" className="form-error">{error}</p>}
    {data ? <AuctionPanel group={data.group} cycle={data.cycle} scope={scope} /> : !error && <p>Loading auction…</p>}
  </>;
}
