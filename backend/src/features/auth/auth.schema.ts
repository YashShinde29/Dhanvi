import { z } from "zod";

// Strings are optional/nullable like System.Text.Json binding; the service produces the field-level validation errors.
const s = () => z.string().nullish().transform((v) => v ?? "");
export const registerBody = z.object({ firstName: s(), lastName: s(), email: s(), phoneNumber: z.string().nullish(), password: s() });
export const loginBody = z.object({ email: s(), password: s() });
export const refreshBody = z.object({ refreshToken: z.string().nullish() }).nullish();
export const forgotBody = z.object({ email: s() });
export const resetBody = z.object({ token: s(), newPassword: s() });
export const profileBody = z.object({ firstName: s(), lastName: s(), phoneNumber: z.string().nullish() });
export const changePasswordBody = z.object({ currentPassword: s(), newPassword: s() });
