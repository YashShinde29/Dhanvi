import { apiClient } from "./api-client";
import type { CurrentUser } from "@/types/auth";

export const userService = {
  updateProfile: (firstName: string, lastName: string, phoneNumber?: string) => apiClient<CurrentUser>("users/me", {
    method: "PUT", body: JSON.stringify({ firstName, lastName, phoneNumber: phoneNumber || null }),
  }),
  changePassword: (currentPassword: string, newPassword: string) => apiClient<void>("users/me/password", {
    method: "PUT", body: JSON.stringify({ currentPassword, newPassword }),
  }),
};

