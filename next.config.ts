import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "@sparticuz/chromium"];
    }
    return config;
  },
};

export default nextConfig;
