import type { NextConfig } from "next";
import path from "node:path";

const adminUrl = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
const workspaceRoot = path.join(__dirname, "../..");

// Production (Vercel): when API_PROXY_TARGET is set, the app proxies /api/* to the backend so the browser only
// talks to this app's own origin. Required because auth cookies are SameSite=Strict; pair it with
// NEXT_PUBLIC_API_BASE_URL=/api/v1. Unset locally, so dev keeps calling the API directly.
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }] : [];
  },
  // Platform administration moved to the admin portal (3001). Old member-app admin URLs redirect there;
  // no admin screen is rendered by this app any more.
  async redirects() {
    return [
      { source: "/admin", destination: `${adminUrl}/dashboard`, permanent: false },
      { source: "/admin/organizers", destination: `${adminUrl}/organizers`, permanent: false },
      { source: "/admin/:path*", destination: `${adminUrl}/:path*`, permanent: false },
    ];
  },
};

export default nextConfig;
