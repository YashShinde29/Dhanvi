import type { Metadata } from "next";
import { LandingPage } from "@/features/marketing/landing-page";

export const metadata: Metadata = { title: "Dhanvi — Save Together. Plan Better." };

export default function Page() {
  return <LandingPage />;
}
