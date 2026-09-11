"use client";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { organizerService } from "@/services/organizer.service";
import type { OrganizerStatusResponse } from "@/types/organizer";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description";
import { StatusBadge } from "@/components/ui/badge";
import { Timeline } from "@/components/ui/timeline";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

export default function ApplicationStatusPage() {
  return <ProtectedPage><ApplicationStatus /></ProtectedPage>;
}

function statusMessage(result: OrganizerStatusResponse): string {
  switch (result.status) {
    case "PENDING": return "Your organizer application has been submitted and is awaiting review.";
    case "UNDER_REVIEW": return "An administrator is reviewing your organizer application.";
    case "APPROVED": return "Your organizer account has been approved. You can now create and manage groups.";
    case "REJECTED": return "Your organizer application was not approved.";
    case "SUSPENDED": return "Your organizer capability is currently suspended.";
    default: return "You have not submitted an organizer application yet.";
  }
}

function ApplicationStatus() {
  const auth = useAuth();
  const { data, error, loading, reload } = useAsyncData(() => organizerService.myStatus(), [auth.user?.id]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <PageSkeleton />;
  const stage = data.status === "NOT_APPLIED" ? 0 : data.status === "PENDING" ? 1 : data.status === "UNDER_REVIEW" ? 2 : 3;
  const decided = ["APPROVED", "REJECTED", "SUSPENDED"].includes(data.status);
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer program" title="Organizer application" description={statusMessage(data)} badges={<StatusBadge kind="organizer" value={data.status} size="lg" />}
        actions={data.status === "APPROVED" ? <LinkButton href="/organizer">Organizer dashboard</LinkButton> : (data.status === "NOT_APPLIED" || data.status === "REJECTED") ? <LinkButton href="/become-organizer">{data.status === "REJECTED" ? "Apply again" : "Apply now"}</LinkButton> : undefined} />
      {data.status === "REJECTED" && data.application?.rejectionReason && <Callout variant="warning" title="Decision reason">{data.application.rejectionReason}</Callout>}
      <div className="grid-sidebar">
        <Card>
          <CardHeader title="Application details" />
          <CardBody>
            {data.application ? (
              <DescriptionList items={[
                { key: "Submitted", value: formatDateTime(data.application.submittedAt) },
                { key: "Reviewed", value: data.application.reviewedAt ? formatDateTime(data.application.reviewedAt) : "Not yet" },
                { key: "Location", value: `${data.application.city}, ${data.application.state} ${data.application.postalCode}` },
                { key: "Reason", value: <span style={{ whiteSpace: "pre-wrap" }}>{data.application.reasonForBecomingOrganizer}</span> },
                ...(data.application.experienceDescription ? [{ key: "Experience", value: <span style={{ whiteSpace: "pre-wrap" }}>{data.application.experienceDescription}</span> }] : []),
              ]} />
            ) : <p className="text-sm text-muted">No application has been submitted.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Review progress" />
          <CardBody>
            <Timeline steps={[
              { id: "apply", title: "Application submitted", state: stage >= 1 ? "done" : "current" },
              { id: "review", title: "Under review", description: "The Dhanvi team checks your details.", state: stage > 2 ? "done" : stage === 2 ? "current" : stage === 1 ? "current" : "upcoming" },
              { id: "decision", title: decided ? (data.status === "APPROVED" ? "Approved" : data.status === "SUSPENDED" ? "Suspended" : "Not approved") : "Decision", state: decided ? "done" : "upcoming" },
            ]} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
