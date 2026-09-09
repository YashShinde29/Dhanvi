import { apiClient } from "./api-client";
import type { Group, GroupInput, GroupPage, Member } from "@/types/group";
export type GroupScope = "public" | "organizer" | "admin" | "mine";
export const groupPath = (scope: GroupScope) =>
  scope === "public"
    ? "groups"
    : scope === "mine"
      ? "my-groups"
      : `${scope}/groups`;
export const groupService = {
  list: (scope: GroupScope, query: string) =>
    apiClient<GroupPage>(`${groupPath(scope)}?${query}`),
  details: (id: string, scope: GroupScope) =>
    apiClient<Group>(`${groupPath(scope)}/${id}`),
  save: (scope: GroupScope, input: GroupInput, id?: string) =>
    apiClient<Group>(`${groupPath(scope)}${id ? `/${id}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),
  action: (path: string, body: object = {}) =>
    apiClient<void>(path, { method: "POST", body: JSON.stringify(body) }),
  members: (id: string, scope: GroupScope) =>
    apiClient<Member[]>(`${groupPath(scope)}/${id}/members`),
  contact: (id: string) =>
    apiClient<{ name: string; phone: string | null; email: string }>(
      `groups/${id}/organizer/contact`,
    ),
};
