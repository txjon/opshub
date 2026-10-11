import type { Metadata } from "next";

// page.tsx is a client component, so its tab title lives here.
export const metadata: Metadata = {
  title: "Start a Project | House Party Distro",
  description: "Tell us about your project and we'll get back to you with next steps.",
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
