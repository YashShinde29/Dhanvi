"use client";
import { useState } from "react";
import { useAsyncData, humanize, formatMoney } from "@dhanvi/utils";
import { payoutService, type GroupScope } from "@dhanvi/api-client";
import { Button, LinkButton, Card, CardBody, CardHeader, Callout } from "@dhanvi/ui";
export function CycleSettlement({ cycleId, groupId, scope }: { cycleId: string; groupId: string; scope: GroupScope }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const admin = scope === "admin", organizer = scope === "organizer";
  const data = useAsyncData(() => organizer ? payoutService.group(groupId, 1) : payoutService.list(admin, admin ? `cycleId=${cycleId}` : "page=1"), [groupId, cycleId, admin, organizer]);
  async function prepare() { setBusy(true); setError(""); try { await payoutService.prepare(cycleId); data.reload(); } catch (e) { setError(e instanceof Error ? e.message : "Settlement preparation failed."); } finally { setBusy(false); } }
  return <Card><CardHeader title="Payout settlement" subtitle="Selection and money settlement are tracked separately." /><CardBody className="stack">
    {(error || data.error) && <Callout variant="danger">{error || data.error}</Callout>}
    {data.data?.items.filter(p => p.cycleId === cycleId).map(p => <p key={p.id}>{humanize(p.payoutType)} · {formatMoney(p.amount)} · {humanize(p.status)}</p>)}
    <div className="row">{admin && <Button loading={busy} onClick={prepare}>Prepare cycle settlement</Button>}<LinkButton variant="secondary" href={admin ? `/payouts?groupId=${groupId}&cycleId=${cycleId}` : organizer ? `/organizer/groups/${groupId}/payouts` : "/payouts"}>View payout status</LinkButton></div>
  </CardBody></Card>;
}
