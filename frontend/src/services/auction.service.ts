import { apiClient } from "./api-client";
import type { Auction, AuctionBid, AuctionResult } from "@/types/auction";

const path = (groupId: string, cycleId: string) =>
  `groups/${groupId}/cycles/${cycleId}/auction`;
export const auctionService = {
  get: (groupId: string, cycleId: string) => apiClient<Auction>(path(groupId, cycleId)),
  myBids: (groupId: string, cycleId: string) => apiClient<AuctionBid[]>(`${path(groupId, cycleId)}/my-bids`),
  result: (groupId: string, cycleId: string) => apiClient<AuctionResult>(`${path(groupId, cycleId)}/result`),
  manage: (scope: "organizer" | "admin", groupId: string, cycleId: string, action: "open" | "close") =>
    apiClient<Auction>(`${scope}/${path(groupId, cycleId)}/${action}`, { method: "POST", body: "{}" }),
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
