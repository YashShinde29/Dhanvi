import { apiClient } from "./api-client";
import type { AuthenticationResponse, CurrentUser } from "@/types/auth";

export interface RegisterInput { firstName: string; lastName: string; email: string; phoneNumber?: string; password: string }

export const authService = {
  register: (input: RegisterInput) => apiClient("auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (email: string, password: string) => apiClient<AuthenticationResponse>("auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  refresh: () => apiClient<AuthenticationResponse>("auth/refresh", { method: "POST", body: "{}" }),
  logout: () => apiClient<void>("auth/logout", { method: "POST", body: "{}" }),
  forgotPassword: (email: string) => apiClient<{ message: string }>("auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) => apiClient<{ message: string }>("auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  currentUser: () => apiClient<CurrentUser>("users/me"),
};

