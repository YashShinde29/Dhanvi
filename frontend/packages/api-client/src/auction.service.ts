import { apiClient } from "./api-client";
import type { Auction, AuctionBid, AuctionResult, AuctionScheduleHistoryPage, RescheduleAuctionInput } from "@dhanvi/types";

const path = (groupId: string, cycleId: string) =>
  `groups/${groupId}/cycles/${cycleId}/auction`;
export const auctionService = {
  get: (groupId: string, cycleId: string) => apiClient<Auction>(path(groupId, cycleId)),
  myBids: (groupId: string, cycleId: string) => apiClient<AuctionBid[]>(`${path(groupId, cycleId)}/my-bids`),
  result: (groupId: string, cycleId: string) => apiClient<AuctionResult>(`${path(groupId, cycleId)}/result`),
  manage: (scope: "organizer" | "admin", groupId: string, cycleId: string, action: "open" | "close") =>
    apiClient<Auction>(`${scope}/${path(groupId, cycleId)}/${action}`, { method: "POST", body: "{}" }),
  /** This cycle's schedule changes, newest first, paged (members receive the sanitized view). */
  scheduleHistory: (groupId: string, cycleId: string, page = 1, pageSize = 5) => apiClient<AuctionScheduleHistoryPage>(`${path(groupId, cycleId)}/schedule-history?page=${page}&pageSize=${pageSize}`),
  /** Every cycle's changes for one group (admin: any group; organizer: own), optional cycle filter, server-paged. */
  groupScheduleHistory: (scope: "organizer" | "admin", groupId: string, query: { cycleId?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) }); if (query.cycleId) q.set("cycleId", query.cycleId);
    return apiClient<AuctionScheduleHistoryPage>(`${scope}/groups/${groupId}/auction-schedule-history?${q}`);
  },
  /** Move a SCHEDULED auction. The backend derives who is acting; the key makes a network retry return the same outcome. */
  reschedule: (scope: "organizer" | "admin", groupId: string, cycleId: string, input: RescheduleAuctionInput, key: string) =>
    apiClient<Auction>(`${scope}/${path(groupId, cycleId)}/reschedule`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input) }),
  bid: (groupId: string, cycleId: string, discount: string, key: string) => {
    if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(discount)) throw new Error("Enter a discount with at most two decimal places.");
    // Preserve the entered decimal token; the backend parses it as decimal.
    return apiClient<AuctionBid>(`${path(groupId, cycleId)}/bids`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: `{"discountAmount":${discount}}`,
    });
  },
};
