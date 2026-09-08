import { env } from "@/lib/env";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly errors: Record<string, string[]> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  const normalizedPath = path.replace(/^\//, "");
  let response = await request(normalizedPath, init);
  if (response.status === 401 && !normalizedPath.startsWith("auth/")) {
    const refreshed = await request("auth/refresh", { method: "POST", body: "{}" });
    if (refreshed.ok) response = await request(normalizedPath, init);
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { title?: string; message?: string; errors?: Record<string, string[]> } | null;
    throw new ApiError(response.status, problem?.message ?? problem?.title ?? `API request failed with status ${response.status}.`, problem?.errors ?? {});
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${env.apiBaseUrl}/${path}`, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
  });
}
