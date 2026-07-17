/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // .eslintrc.json exists as the MANUAL no-undef guard for the .jsx money
    // path (run: npx eslint app components lib --ext .jsx,.js). It is not a
    // build gate — its plain parser can't read the .ts files, so letting
    // next build run it fails the deploy (2026-07-17 incident).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
