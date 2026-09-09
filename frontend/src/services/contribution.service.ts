import { apiClient } from "./api-client";
import type {
  Contribution,
  ContributionEntry,
  ContributionPage,
  MonthlyCycle,
} from "@/types/contribution";
export const contributionService = {
  cycles: (groupId: string, scope?: "organizer" | "admin") =>
    apiClient<MonthlyCycle[]>(
      `${scope ? `${scope}/` : ""}groups/${groupId}/cycles`,
    ),
  mine: (query: string) =>
    apiClient<ContributionPage>(`me/contributions?${query}`),
  myGroup: (groupId: string) =>
    apiClient<Contribution[]>(`groups/${groupId}/my-contributions`),
  cycleContributions: (scope: string, groupId: string, cycleId: string) =>
    apiClient<Contribution[]>(
      `${scope}/groups/${groupId}/cycles/${cycleId}/contributions`,
    ),
  operate: (path: string, key: string, body: object) =>
    apiClient<{ entry: ContributionEntry; replayed: boolean }>(path, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  markOverdue: (scope: string, groupId: string) =>
    apiClient<{ markedCount: number }>(
      `${scope}/groups/${groupId}/mark-overdue`,
      { method: "POST", body: "{}" },
    ),
};
