import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.join(__dirname, "../..");

// Production (Vercel): when API_PROXY_TARGET is set, the app proxies /api/* to the backend so the browser only
// talks to this app's own origin. Required because auth cookies are SameSite=Strict; pair it with
// NEXT_PUBLIC_API_URL set to this app's own URL. Unset locally, so dev keeps calling the API directly.
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

// Docker builds use standalone output traced from the frontend workspace. Vercel traces from the repository root
// itself, so these settings are skipped there (VERCEL=1 during Vercel builds).
const selfHosted = process.env.VERCEL
  ? {}
  : { output: "standalone" as const, outputFileTracingRoot: workspaceRoot, turbopack: { root: workspaceRoot } };

const nextConfig: NextConfig = {
  ...selfHosted,
  agentRules: false,
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
