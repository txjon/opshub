import type { Metadata } from "next";

// page.tsx is a client component, so its tab title lives here.
// Unlisted per-client link: keep it out of search.
export const metadata: Metadata = {
  title: "The Build | House Party Distro",
  robots: { index: false, follow: false },
};

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return children;
}
