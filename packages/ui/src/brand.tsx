import Link from "next/link";
import Image from "next/image";

/**
 * Brand artwork is served from each app's `public/brand/` folder, generated from the masters in `assets/brand/`
 * by `tools/generate-brand-assets.py`. Both apps serve the same paths, so this shared component can reference them
 * directly. Tab and home-screen icons are separate files picked up by the Next.js app-directory conventions
 * (`src/app/icon.png`, `src/app/apple-icon.png`).
 *
 * The files are already trimmed, sized and palette-quantised, so they skip the image optimiser: nothing is gained by
 * re-encoding them, and the standalone Docker image then needs no runtime optimiser.
 */
const MARK = "/brand/mark.png";
const LOCKUP = { light: "/brand/logo.png", dark: "/brand/logo-dark.png" } as const;

/** Square app mark (rounded green tile). Used where space is tight: the sidebar, the collapsed tablet rail. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return <Image className="brand__mark" src={MARK} alt="" width={size} height={size} priority unoptimized />;
}

/**
 * Full logo lockup (mark + wordmark). `light` selects the reversed artwork for dark grounds; `suffix` labels a
 * sub-brand next to the logo (the admin portal), which the wordmark itself does not carry.
 */
export function Brand({ href = "/", light, className, label = "Dhanvi", suffix, height = 30 }: { href?: string; light?: boolean; className?: string; label?: string; suffix?: string; height?: number }) {
  return (
    <Link href={href} className={["brand", light ? "brand--light" : "", className ?? ""].filter(Boolean).join(" ")} aria-label={`${label} home`}>
      <Image className="brand__logo" src={light ? LOCKUP.dark : LOCKUP.light} alt={label} width={Math.round(height * 3.2)} height={height} style={{ height, width: "auto" }} priority unoptimized />
      {suffix && <span className="brand__suffix">{suffix}</span>}
    </Link>
  );
}
