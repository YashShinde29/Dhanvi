import type { OrganizerStatusResponse } from "@dhanvi/types";
import { formatDate, statusGuidance } from "@dhanvi/utils";
import type { WorkflowStep, WorkflowSummary } from "./workflow-status";

export function organizerSteps(status: string): WorkflowStep[] {
  const rank = status === "NOT_APPLIED" ? 0 : status === "PENDING" ? 1 : status === "UNDER_REVIEW" ? 2 : status === "APPROVED" ? 3 : -1;
  const s = (i: number, cur: WorkflowStep["state"] = "current"): WorkflowStep["state"] => (rank === -1 ? (i <= 2 ? "complete" : "blocked") : i < rank ? "complete" : i === rank ? cur : "upcoming");
  return [
    { id: "apply", label: "Application submitted", state: s(0) },
    { id: "review", label: "Dhanvi review", state: s(1, "waiting") },
    { id: "decision", label: "Under review", state: s(2, "waiting") },
    { id: "setup", label: "Approved · organizer setup", state: rank >= 3 ? "complete" : rank === -1 ? "blocked" : "upcoming" },
  ];
}

export function organizerSummary(result: OrganizerStatusResponse): WorkflowSummary {
  const g = statusGuidance("organizer", result.status);
  const steps = organizerSteps(result.status);
  const submitted = result.application?.submittedAt ? `Submitted ${formatDate(result.application.submittedAt)}.` : undefined;
  switch (result.status) {
    case "PENDING": case "UNDER_REVIEW": return { stage: g.stage, status: "waiting", headline: "Waiting for Dhanvi to review your application.", detail: `${submitted ?? ""} No action is required from you.`, steps, responsibleRole: "ADMIN", waitingFor: "a Dhanvi administrator to review your application", next: "Once approved you can create your first group." };
    case "APPROVED": return { stage: "Approved organizer", status: "complete", headline: "You can create and manage savings groups.", steps, responsibleRole: "USER", next: "Create a group, publish it and review member applications.", action: { title: "Create your first group", status: "current", responsibleRole: "USER", actionLabel: "Create group", actionHref: "/organizer/groups/create" } };
    case "REJECTED": return { stage: g.stage, status: "blocked", headline: "Your application was not approved.", blockedBy: result.application?.rejectionReason ?? "No reason was provided.", steps, responsibleRole: "USER", next: "You may submit a new application.", action: { title: "Submit a new application", status: "current", responsibleRole: "USER", actionLabel: "Apply again", actionHref: "/become-organizer" } };
    case "SUSPENDED": return { stage: g.stage, status: "blocked", headline: g.description, blockedBy: "Organizer access is suspended by Dhanvi.", steps, responsibleRole: "ADMIN" };
    default: return { stage: g.stage, status: "current", headline: g.description, steps, responsibleRole: "USER", action: { title: "Apply to become an organizer", status: "current", responsibleRole: "USER", actionLabel: "Start application", actionHref: "/become-organizer" } };
  }
}
