"use client";
import { ProtectedPage, useAuth } from "@dhanvi/auth";
import { organizerService } from "@dhanvi/api-client";
import type { OrganizerStatusResponse } from "@dhanvi/types";
import { useAsyncData, formatDateTime } from "@dhanvi/utils";
import { WorkflowStatusCard, organizerSummary } from "@dhanvi/features/workflow";
import { PageHeader, ErrorState, Card, CardBody, CardHeader, DescriptionList, StatusBadge, PageSkeleton } from "@dhanvi/ui";

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
  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer program" title="Organizer application" description={statusMessage(data)} badges={<StatusBadge kind="organizer" value={data.status} size="lg" />} />
      <WorkflowStatusCard summary={organizerSummary(data)} viewer="member" title="Application progress" stepperLabel="Organizer application steps" />
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
          <CardHeader title="What happens next" />
          <CardBody className="stack">
            <p className="text-sm text-secondary">{data.status === "APPROVED" ? "Create a group, publish it, and review member applications. Members apply to your published groups; you approve them and start the group once it is full." : data.status === "PENDING" || data.status === "UNDER_REVIEW" ? "A Dhanvi administrator reviews your details. Once approved, the organizer tools appear in your navigation and you can create your first group." : data.status === "REJECTED" ? "You can submit a new application addressing the reason above." : data.status === "SUSPENDED" ? "Contact Dhanvi to restore organizer access." : "Submit an application to start organizing savings groups."}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
