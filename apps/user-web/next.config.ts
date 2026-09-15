import type { NextConfig } from "next";
import path from "node:path";

const adminUrl = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
const workspaceRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
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
