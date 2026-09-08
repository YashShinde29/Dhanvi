import { ApiError } from "@/services/api-client";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return Object.values(error.errors).flat()[0] ?? error.message;
  return "Something went wrong. Please try again.";
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/\d/.test(password)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add a special character.";
  return null;
}

