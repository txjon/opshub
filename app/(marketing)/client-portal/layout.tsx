import type { Metadata } from "next";

// page.tsx is a client component, so its tab title lives here.
export const metadata: Metadata = {
  title: "Client Portal | House Party Distro",
  description: "Existing House Party Distro clients: get a link to your portal by email.",
};

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
