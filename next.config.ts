import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["orgo-vnc"],
  // Keep the Orgo CDP sender script in the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/lib/vm/airsup-chatgpt-send.js"],
  },
};

export default nextConfig;
