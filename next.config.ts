import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
    serverComponentsExternalPackages: ["puppeteer-core", "chrome-aws-lambda"],
  },
};

export default nextConfig;
