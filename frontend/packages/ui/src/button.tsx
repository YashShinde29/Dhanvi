"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string, block?: boolean, iconOnly?: boolean) {
  return ["btn", `btn--${variant}`, size !== "md" ? `btn--${size}` : "", block ? "btn--block" : "", iconOnly ? "btn--icon" : "", extra ?? ""].filter(Boolean).join(" ");
}

export function Button({ variant = "primary", size = "md", loading = false, block, icon, iconOnly, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className, block, iconOnly)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {!iconOnly && children}
      {iconOnly && <span className="visually-hidden">{children}</span>}
    </button>
  );
}

interface LinkButtonProps { href: string; variant?: ButtonVariant; size?: ButtonSize; block?: boolean; icon?: ReactNode; className?: string; children: ReactNode }

export function LinkButton({ href, variant = "primary", size = "md", block, icon, className, children }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClass(variant, size, className, block)}>
      {icon}
      {children}
    </Link>
  );
}
