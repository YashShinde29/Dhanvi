import { apiClient } from "./api-client";
import type { OrganizerStatusResponse, OrganizerApplicationSummary, PagedResponse } from "@/types/organizer";

export interface OrganizerApplicationInput {
  address: string; city: string; state: string; postalCode: string;
  reasonForBecomingOrganizer: string; experienceDescription?: string;
}

export const organizerService = {
  apply: (input: OrganizerApplicationInput) => apiClient<OrganizerStatusResponse>("organizers/apply", { method: "POST", body: JSON.stringify(input) }),
  myStatus: () => apiClient<OrganizerStatusResponse>("organizers/me"),
  applications: (page = 1, pageSize = 20, status = "", search = "") => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(status ? { status } : {}), ...(search ? { search } : {}) });
    return apiClient<PagedResponse<OrganizerApplicationSummary>>(`admin/organizer-applications?${query}`);
  },
  approve: (id: string) => apiClient<void>(`admin/organizer-applications/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) => apiClient<void>(`admin/organizer-applications/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
};
