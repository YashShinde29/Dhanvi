import type { OrganizerStatus } from "./auth";

export interface OrganizerApplicationDetails {
  id: string; submittedAt: string; reviewedAt: string | null; rejectionReason: string | null;
  address: string; city: string; state: string; postalCode: string;
  reasonForBecomingOrganizer: string; experienceDescription: string | null;
}
export interface OrganizerStatusResponse { status: OrganizerStatus; application: OrganizerApplicationDetails | null }
export interface OrganizerApplicationSummary {
  id: string; userId: string; applicant: string; email: string; phone: string | null; submittedAt: string; status: OrganizerStatus;
}
export interface PagedResponse<T> { items: T[]; page: number; pageSize: number; totalCount: number }

