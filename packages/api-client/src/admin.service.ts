import { apiClient } from "./api-client";
import type { AdminGroupPage, AdminGroupSummary, AdminOverview } from "@dhanvi/types";

/** Read-only Admin Control Center queries. Commands keep using their module services (group, selection, auction, payout…). */
export const adminService = {
  overview: () => apiClient<AdminOverview>("admin/operations/overview"),
  groups: (query: string) => apiClient<AdminGroupPage>(`admin/groups/operations?${query}`),
  groupSummary: (groupId: string) => apiClient<AdminGroupSummary>(`admin/groups/${groupId}/operations-summary`),
};
