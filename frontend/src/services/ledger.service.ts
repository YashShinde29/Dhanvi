import { apiClient } from "./api-client";
import type { Journal, JournalSummary, LedgerAccount, LedgerPage, MemberLedgerLine, TrialBalance } from "@/types/ledger";
export const ledgerService = {
  accounts: () => apiClient<LedgerAccount[]>("admin/ledger/accounts"),
  journals: (query: string, groupId?: string) => apiClient<LedgerPage<JournalSummary>>(`admin/ledger/${groupId ? `groups/${groupId}` : "journals"}?${query}`),
  journal: (id: string) => apiClient<Journal>(`admin/ledger/journals/${id}`),
  trialBalance: (query: string, groupId?: string) => apiClient<TrialBalance>(`admin/ledger/${groupId ? `groups/${groupId}/balances` : "trial-balance"}?${query}`),
  mine: (query: string) => apiClient<LedgerPage<MemberLedgerLine>>(`me/ledger?${query}`),
};
