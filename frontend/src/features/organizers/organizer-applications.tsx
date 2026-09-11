"use client";
import Link from "next/link";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { groupService } from "@/services/group.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { GroupTypeBadge, StatusBadge } from "@/components/ui/badge";
import { Icons } from "@/components/ui/icons";
import { SkeletonTable } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";

/** Cross-group view of pending applications, derived from the organizer's group list. */
export function OrganizerApplicationsPage() {
  return <ProtectedPage roles={["ORGANIZER"]}><Content /></ProtectedPage>;
}

function Content() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsyncData(() => groupService.list("organizer", "page=1&pageSize=100"), [user?.id]);
  const groups = (data?.items ?? []).filter((g) => g.pendingApplications > 0).sort((a, b) => b.pendingApplications - a.pendingApplications);
  const total = groups.reduce((s, g) => s + g.pendingApplications, 0);
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer" title="Applications" description={total ? `${total} application${total === 1 ? "" : "s"} waiting for review across ${groups.length} group${groups.length === 1 ? "" : "s"}.` : "Membership applications across all your groups."} />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <SkeletonTable rows={4} /> : groups.length === 0 ? (
        <EmptyState icon={<Icons.Inbox size={24} />} title="No applications" description="No membership applications are waiting for review." action={<LinkButton href="/organizer/groups" variant="secondary">View my groups</LinkButton>} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {groups.map((g) => (
            <Link key={g.id} href={`/organizer/groups/${g.id}/applications`} className="attention attention--warning">
              <span className="attention__count">{g.pendingApplications}</span>
              <span className="attention__text">
                <span className="attention__title">{g.name}</span>
                <span className="attention__desc">{formatMoney(g.groupValue)} · {g.currentMemberCount}/{g.memberLimit} members · {g.availableSlots} open positions</span>
              </span>
              <span className="row" style={{ gap: 6 }}><GroupTypeBadge type={g.groupType} /><StatusBadge kind="group" value={g.status} /><Icons.ChevronRight size={18} style={{ color: "var(--color-text-muted)" }} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
