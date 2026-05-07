import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Per-tenant favicon + browser tab title so HPD vs IHM tabs are
// visually distinguishable when both are open. Slug resolution
// mirrors lib/company.ts — Host header → slug map. Falls back to
// HPD when nothing matches.
const TENANT_TAB_META: Record<string, { title: string; icon: string }> = {
  hpd: { title: "OpsHub · HPD", icon: "/favicon-hpd.svg" },
  ihm: { title: "OpsHub · IHM", icon: "/favicon-ihm.svg" },
};
function slugFromHost(host: string | null): string {
  if (!host) return "hpd";
  const h = host.toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export async function generateMetadata(): Promise<Metadata> {
  let slug = "hpd";
  try {
    const h = await headers();
    slug = h.get("x-company-slug") || slugFromHost(h.get("host"));
  } catch {
    // Outside request context (build) — leave as default.
  }
  const meta = TENANT_TAB_META[slug] || TENANT_TAB_META.hpd;
  return {
    title: meta.title,
    description: "Internal operations management platform",
    icons: {
      icon: [{ url: meta.icon, type: "image/svg+xml" }],
      shortcut: meta.icon,
      apple: meta.icon,
    },
  };
}

// Ensure mobile browsers render at device width so client portals and
// any other mobile-responsive surfaces lay out correctly. viewport-fit=cover
// lets content extend under notches on iPhones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
