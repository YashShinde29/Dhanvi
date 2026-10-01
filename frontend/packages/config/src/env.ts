// Origin of the Fastify backend that both web apps call. An empty value means "same origin" (deployments that proxy
// /api/* through the web app, see API_PROXY_TARGET in next.config.ts).
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

// Public values are fixed at build time. Local Docker builds explicitly use the development policy.
const productionMinimum = 20;
const developmentMinimum = Number(process.env.NEXT_PUBLIC_MIN_GROUP_MEMBERS ?? productionMinimum);
const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV;
const minimumGroupMembers = appEnvironment === "development" || appEnvironment === "test"
  ? developmentMinimum
  : productionMinimum;
if (!Number.isInteger(minimumGroupMembers) || minimumGroupMembers < 2 || minimumGroupMembers > 50) {
  throw new Error("NEXT_PUBLIC_MIN_GROUP_MEMBERS must be an integer between 2 and 50.");
}

export type AppKind = "user" | "admin";
const trimSlash = (value: string) => value.replace(/\/$/, "");

export const env = {
  minimumGroupMembers,
  maximumGroupMembers: 50,
  /** Backend origin, e.g. http://localhost:3002 ("" = same origin). */
  apiUrl: trimSlash(configuredApiUrl),
  /** Versioned REST base used by every service in @dhanvi/api-client. */
  apiBaseUrl: `${trimSlash(configuredApiUrl)}/api/v1`,
  /** Which web application this bundle is: the member app (3000) or the admin portal (3001). */
  appKind: (process.env.NEXT_PUBLIC_APP_KIND === "admin" ? "admin" : "user") as AppKind,
  /** Absolute URL of the member web app, used for cross-app links. */
  userAppUrl: trimSlash(process.env.NEXT_PUBLIC_USER_APP_URL ?? "http://localhost:3000"),
  /** Absolute URL of the admin portal, used for cross-app links. */
  adminAppUrl: trimSlash(process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001"),
};
