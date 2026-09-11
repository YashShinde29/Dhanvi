import Link from "next/link";

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand__mark" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9 10.5h4.5a1.75 1.75 0 0 1 0 3.5H9" />
      </svg>
    </span>
  );
}

export function Brand({ href = "/", light, className }: { href?: string; light?: boolean; className?: string }) {
  return (
    <Link href={href} className={["brand", light ? "brand--light" : "", className ?? ""].filter(Boolean).join(" ")} aria-label="Dhanvi home">
      <BrandMark />
      <span className="sidebar__label">Dhanvi</span>
    </Link>
  );
}
