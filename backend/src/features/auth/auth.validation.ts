import type { PasswordPolicy } from "../../config/auth.js";
import { ValidationError } from "../../utils/errors.js";

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

/** Approximation of MailAddress.TryCreate: one @, non-empty local part and host, no whitespace or display name. */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length === 0 || email.length > 320 || /\s/.test(email) || /[<>()[\]\\,;"]/.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const host = email.slice(at + 1);
  return !host.startsWith(".") && !host.endsWith(".") && !host.includes("..") && !email.slice(0, at).includes("@");
}

/** PasswordRulesValidator.Validate — Unicode-aware like char.IsUpper / IsLower / IsDigit / IsLetterOrDigit. */
export function passwordErrors(password: string, policy: PasswordPolicy): string[] {
  const errors: string[] = [];
  if (password.length < policy.minimumLength) errors.push(`Password must contain at least ${policy.minimumLength} characters.`);
  if (policy.requireUppercase && !/\p{Lu}/u.test(password)) errors.push("Password must contain an uppercase letter.");
  if (policy.requireLowercase && !/\p{Ll}/u.test(password)) errors.push("Password must contain a lowercase letter.");
  if (policy.requireDigit && !/\p{Nd}/u.test(password)) errors.push("Password must contain a number.");
  if (policy.requireSpecialCharacter && /^[\p{L}\p{Nd}]*$/u.test(password)) errors.push("Password must contain a special character.");
  return errors;
}

function profileErrors(firstName: string, lastName: string, phone: string | null | undefined): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!firstName.trim()) errors.firstName = ["First name is required."];
  if (!lastName.trim()) errors.lastName = ["Last name is required."];
  if (phone && phone.trim() && !PHONE.test(phone)) errors.phoneNumber = ["Phone number format is invalid."];
  return errors;
}

const throwIfAny = (errors: Record<string, string[]>) => { if (Object.keys(errors).length > 0) throw new ValidationError(errors); };

export function validateRegistration(r: { firstName: string; lastName: string; email: string; phoneNumber?: string | null; password: string }, policy: PasswordPolicy): void {
  const errors = profileErrors(r.firstName, r.lastName, r.phoneNumber);
  if (!isValidEmail(r.email)) errors.email = ["A valid email is required."];
  const pw = passwordErrors(r.password, policy);
  if (pw.length > 0) errors.password = pw;
  throwIfAny(errors);
}

export const validateProfile = (r: { firstName: string; lastName: string; phoneNumber?: string | null }) => throwIfAny(profileErrors(r.firstName, r.lastName, r.phoneNumber));

export function validateNewPassword(password: string, policy: PasswordPolicy): void {
  const errors = passwordErrors(password, policy);
  if (errors.length > 0) throw new ValidationError({ newPassword: errors });
}

/** email.Trim().ToUpperInvariant() — single-character mappings only, like the invariant culture. */
export function normalizeEmail(email: string): string {
  return [...email.trim()].map((c) => { const u = c.toUpperCase(); return u.length === c.length ? u : c; }).join("");
}

export const normalizePhone = (phone: string | null | undefined): string | null => (phone && phone.trim() ? phone.trim() : null);
