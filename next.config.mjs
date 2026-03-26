/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'ag-psd', 'pdfkit'],
  },
};

export default nextConfig;
