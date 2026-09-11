import { env } from "@/lib/env";

interface ProblemPayload { title?: string; detail?: string; message?: string; code?: string; type?: string; errors?: Record<string, string[]> }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: Record<string, string[]> = {},
    public readonly code: string | null = null,
  ) {
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
    const problem = await response.json().catch(() => null) as ProblemPayload | null;
    const message = problem?.message ?? problem?.detail ?? problem?.title ?? `API request failed with status ${response.status}.`;
    const code = problem?.code ?? (problem?.type && /^[A-Z_]+$/.test(problem.type) ? problem.type : null);
    throw new ApiError(response.status, message, problem?.errors ?? {}, code);
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
