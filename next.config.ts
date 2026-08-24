import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep the Orgo CDP sender script in the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/lib/vm/airsup-chatgpt-send.js"],
  },
  async redirects() {
    return [
      { source: "/portal", destination: "/company", permanent: false },
      { source: "/portal/:path*", destination: "/company", permanent: false },
      { source: "/airsup", destination: "/company", permanent: false },
      { source: "/ainet", destination: "/company", permanent: false },
    ];
  },
};

export default nextConfig;
