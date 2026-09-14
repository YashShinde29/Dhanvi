import { Suspense } from "react";
import { PayoutsPage } from "@/features/payouts/payout-pages";
export default function Page() { return <Suspense><PayoutsPage organizer /></Suspense>; }
