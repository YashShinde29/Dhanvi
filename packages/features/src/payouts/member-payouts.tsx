"use client";
import { PayoutsPage } from "./payout-pages";
import { PayoutAccountForm } from "./payout-account";

/** Member portal payouts: status list plus the payout bank-account form. */
export function MemberPayoutsPage() {
  return <PayoutsPage accountForm={<PayoutAccountForm />} />;
}
