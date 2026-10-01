import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.join(__dirname, "../..");

// Production (Vercel): when API_PROXY_TARGET is set, the app proxies /api/* to the backend so the browser only
// talks to this app's own origin. Required because auth cookies are SameSite=Strict; pair it with
// an empty NEXT_PUBLIC_API_URL (same origin). Unset locally, so dev keeps calling the API directly.
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }] : [];
  },
};

export default nextConfig;
