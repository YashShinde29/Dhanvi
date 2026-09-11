export { friendlyError as errorMessage, fieldErrors } from "@/lib/errors";

export function passwordError(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/\d/.test(password)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add a special character.";
  return null;
}

export const PASSWORD_HINT = "At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";
