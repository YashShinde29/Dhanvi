import { apiClient } from "./api-client";
import type { Payout, PayoutAccount, PayoutAccountRequest, PayoutDetails, PayoutPage } from "@dhanvi/types";
export const payoutService = {
  list: (admin: boolean, query: string) => apiClient<PayoutPage>(`${admin ? "admin" : "me"}/payouts?${query}`),
  group: (group: string, page: number) => apiClient<PayoutPage>(`organizer/groups/${group}/payouts?page=${page}`),
  details: (id: string, admin: boolean) => apiClient<PayoutDetails>(`${admin ? "admin" : "me"}/payouts/${id}`),
  action: (id: string, action: string, key: string) => apiClient<Payout>(`admin/payouts/${id}/${action}`, { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" }),
  prepare: (cycle: string) => apiClient<Payout[]>(`admin/cycles/${cycle}/prepare-settlement`, { method: "POST", body: "{}" }),
  evaluate: (cycle: string) => apiClient<boolean>(`admin/cycles/${cycle}/evaluate-settlement`, { method: "POST", body: "{}" }),
  account: () => apiClient<PayoutAccount | null>("users/me/payout-account"),
  saveAccount: (request: PayoutAccountRequest) => apiClient<PayoutAccount>("users/me/payout-account", { method: "POST", body: JSON.stringify(request) }),
};
