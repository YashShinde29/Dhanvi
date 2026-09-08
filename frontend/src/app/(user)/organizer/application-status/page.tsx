"use client";

import { useEffect, useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { organizerService } from "@/services/organizer.service";
import type { OrganizerStatusResponse } from "@/types/organizer";
import { errorMessage } from "@/utils/forms";

export default function ApplicationStatusPage() {
  const [result, setResult] = useState<OrganizerStatusResponse | null>(null); const [error, setError] = useState("");
  useEffect(() => { organizerService.myStatus().then(setResult).catch(failure => setError(errorMessage(failure))); }, []);
  return <ProtectedPage><section className="panel"><p className="eyebrow">Organizer program</p><h1>Application status</h1>
    {error && <p className="form-error">{error}</p>}{!result && !error && <p>Loading...</p>}
    {result && <><p className={`status-badge status-${result.status.toLowerCase()}`}>{result.status.replaceAll("_", " ")}</p><p>{statusMessage(result)}</p>
      {result.application ? <dl className="details-list"><dt>Submitted</dt><dd>{new Date(result.application.submittedAt).toLocaleString()}</dd><dt>Location</dt><dd>{result.application.city}, {result.application.state} {result.application.postalCode}</dd><dt>Reason</dt><dd>{result.application.reasonForBecomingOrganizer}</dd>{result.application.rejectionReason && <><dt>Decision reason</dt><dd>{result.application.rejectionReason}</dd></>}</dl> : <p>No application has been submitted.</p>}</>}
  </section></ProtectedPage>;
}

function statusMessage(result: OrganizerStatusResponse): string {
  switch (result.status) {
    case "PENDING": return "Your organizer application has been submitted and is awaiting review.";
    case "UNDER_REVIEW": return "An administrator is reviewing your organizer application.";
    case "APPROVED": return "Your organizer account has been approved.";
    case "REJECTED": return result.application?.rejectionReason ? `Your application was rejected: ${result.application.rejectionReason}` : "Your organizer application was rejected.";
    case "SUSPENDED": return "Your organizer capability is currently suspended.";
    default: return "You have not submitted an organizer application yet.";
  }
}
