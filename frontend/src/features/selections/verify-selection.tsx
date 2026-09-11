"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { selectionService } from "@/services/selection.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icons } from "@/components/ui/icons";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { DrawProof } from "@/types/selection";

export function VerifySelectionPage() {
  return <ProtectedPage><Verification /></ProtectedPage>;
}

function Verification() {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const { data, error, loading, reload } = useAsyncData(() => selectionService.verify(id, cycleId), [id, cycleId]);
  const [recalculating, setRecalculating] = useState(false);
  const crumbs = [{ label: "My groups", href: "/my-groups" }, { label: "Group", href: `/groups/${id}` }, { label: "Verify draw" }];
  async function recalc() { setRecalculating(true); await reload(); setRecalculating(false); }
  if (error) return <div className="stack"><Breadcrumbs items={crumbs} /><ErrorState message={error} onRetry={reload} /></div>;
  if (loading || !data) return <PageSkeleton />;
  const proof = data.proof;
  const winnerSlot = proof.canonicalEligibleMembers.find((m) => m.membershipId === proof.winnerMembershipId)?.slotNumber;
  const rows: { key: string; value: string | number }[] = [
    ["Algorithm", proof.algorithmVersion], ["Cycle", proof.cycleNumber], ["Eligible member count", proof.canonicalEligibleMembers.length],
    ["Eligible set hash", proof.eligibleSetHash], ["Seed commitment", proof.seedCommitment], ["Revealed seed", proof.seedReveal],
    ["Selected slot", winnerSlot !== undefined ? `Member #${winnerSlot} (index ${proof.selectedIndex})` : `Index ${proof.selectedIndex}`], ["Result hash", proof.resultHash],
  ].map(([key, value]) => ({ key: String(key), value: value as string | number }));
  const columns: Column<DrawProof["canonicalEligibleMembers"][number] & { ordinal: number }>[] = [
    { key: "ordinal", header: "Index", render: (m) => <span className="num">{m.ordinal}</span> },
    { key: "slot", header: "Member slot", primary: true, render: (m) => <span className="text-strong">#{m.slotNumber}{m.membershipId === proof.winnerMembershipId ? <span className="badge badge--success" style={{ marginLeft: 8 }}>Selected</span> : null}</span> },
    { key: "id", header: "Membership ID", render: (m) => <code className="mono">{m.membershipId}</code> },
  ];
  return (
    <div className="stack stack--lg">
      <PageHeader breadcrumbs={crumbs} eyebrow="Transparency" title="Random draw verification" description="Dhanvi recalculates the draw from the recorded eligible set and revealed seed, then compares it with the stored result." actions={<Button variant="secondary" loading={recalculating} onClick={recalc} icon={<Icons.Refresh size={16} />}>Recalculate</Button>} />
      {data.valid
        ? <Callout variant="success" title="Verification status: ✓ Valid" role="status">This result has been independently recalculated and matches the stored draw result.</Callout>
        : <Callout variant="danger" title="Verification failed">{data.failureReason ?? "The recalculated result does not match the stored draw."}</Callout>}
      <Card>
        <CardHeader title="Draw record" subtitle="These values are fixed at execution time and can be checked by anyone with this page." />
        <CardBody>
          <dl style={{ margin: 0 }}>
            {rows.map((row) => <div key={row.key} className="verify-row"><dt>{row.key}</dt><dd>{row.value}</dd></div>)}
          </dl>
        </CardBody>
      </Card>
      <details className="disclosure">
        <summary>Advanced details — eligible snapshot and raw payload</summary>
        <div className="disclosure__body">
          <p className="text-sm text-muted">Verification checks internal consistency of the recorded draw. This version does not prove that the seed was committed before execution to an external party.</p>
          <DataTable columns={columns} rows={proof.canonicalEligibleMembers.map((m, ordinal) => ({ ...m, ordinal }))} rowKey={(m) => m.membershipId} caption="Canonical eligible snapshot" compact />
          <pre className="pre">{JSON.stringify(data, null, 2)}</pre>
        </div>
      </details>
    </div>
  );
}
