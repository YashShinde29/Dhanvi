import { initials } from "@/lib/format";

export function Avatar({ name, size, tone }: { name: string | null | undefined; size?: "sm" | "lg"; tone?: "navy" }) {
  return <span className={["avatar", size ? `avatar--${size}` : "", tone ? `avatar--${tone}` : ""].filter(Boolean).join(" ")} aria-hidden>{initials(name)}</span>;
}
