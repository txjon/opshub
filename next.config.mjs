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
  // The shop + blog are native Shopify (Oct 2026); the headless /shop pages are gone.
  // Product handles match 1:1. permanent:false (307) until the switch is
  // verified, then flip to true (308): browsers cache 308s indefinitely.
  // Redirects run before middleware, so /shop never needs the public allowlist.
  async redirects() {
    return [
      { source: "/shop", destination: "https://shop.housepartydistro.com", permanent: false },
      { source: "/shop/:handle", destination: "https://shop.housepartydistro.com/products/:handle", permanent: false },
      // The blog lives on Shopify too; /blog is the shareable short URL.
      { source: "/blog", destination: "https://shop.housepartydistro.com/blogs/the-house-blog", permanent: false },
      { source: "/blog/:slug", destination: "https://shop.housepartydistro.com/blogs/the-house-blog/:slug", permanent: false },
    ];
  },
};

export default nextConfig;
