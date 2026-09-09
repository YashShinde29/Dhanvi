import { apiClient } from "./api-client";
import type { SelectionResult, SelectionVerification } from "@/types/selection";
const path = (groupId: string, cycleId: string) =>
  `groups/${groupId}/cycles/${cycleId}/selection`;
export const selectionService = {
  get: (groupId: string, cycleId: string) =>
    apiClient<SelectionResult>(path(groupId, cycleId)),
  preview: (groupId: string, cycleId: string) =>
    apiClient<{
      eligibleMemberCount: number;
      algorithmVersion: string;
      selectionMethod: string;
    }>(`${path(groupId, cycleId)}/preview`),
  execute: (groupId: string, cycleId: string) =>
    apiClient<SelectionResult>(path(groupId, cycleId), {
      method: "POST",
      body: "{}",
    }),
  verify: (groupId: string, cycleId: string) =>
    apiClient<SelectionVerification>(`${path(groupId, cycleId)}/verify`),
};
