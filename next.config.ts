import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `npm run dev` is often opened at 127.0.0.1. Next blocks that origin unless it is listed,
  // which skips hydration and makes the page look frozen.
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
};

export default nextConfig;
