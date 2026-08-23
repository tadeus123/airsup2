import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["orgo-vnc"],
  // Keep the Orgo CDP sender script in the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/lib/vm/airsup-chatgpt-send.js"],
  },
  async rewrites() {
    return [{ source: "/mcp", destination: "/api/mcp" }, { source: "/mcp/:path*", destination: "/api/mcp" }];
  },
};

export default nextConfig;
