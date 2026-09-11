import type { ReactNode } from "react";
import { presentStatus, type StatusKind, type Tone } from "@/lib/status";

export function Badge({ tone = "neutral", children, plain, size, className }: { tone?: Tone; children: ReactNode; plain?: boolean; size?: "lg"; className?: string }) {
  return <span className={["badge", `badge--${tone}`, plain ? "badge--plain" : "", size ? `badge--${size}` : "", className ?? ""].filter(Boolean).join(" ")}>{children}</span>;
}

/** The single status badge used across the app. Maps backend enums to label + tone. */
export function StatusBadge({ kind, value, size }: { kind: StatusKind; value: string | null | undefined; size?: "lg" }) {
  const { label, tone } = presentStatus(kind, value);
  return <Badge tone={tone} size={size}>{label}</Badge>;
}

export function GroupTypeBadge({ type, size }: { type: string; size?: "lg" }) {
  const auction = type === "AUCTION";
  return <span className={`badge badge--plain badge--type-${auction ? "auction" : "random"}${size ? ` badge--${size}` : ""}`}>{auction ? "Auction group" : "Random group"}</span>;
}

export function CreatorTypeBadge({ creatorType, size }: { creatorType: "PLATFORM" | "ORGANIZER"; size?: "lg" }) {
  return <Badge tone={creatorType === "PLATFORM" ? "emerald" : "neutral"} plain size={size}>{creatorType === "PLATFORM" ? "Dhanvi platform" : "Organizer group"}</Badge>;
}
