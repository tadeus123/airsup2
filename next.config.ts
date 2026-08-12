import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/mcp", destination: "/api/mcp" }, { source: "/mcp/:path*", destination: "/api/mcp" }];
  },
};

export default nextConfig;
