import { Metadata } from "next";
import { ContactClient } from "./_components/ContactClient";

export const metadata: Metadata = {
  title: "Contact — House Party Distro",
  description: "Get in touch with the team at House Party Distro.",
};

export default function ContactPage() {
  return (
    <div style={{ background: "#0a0a0c", color: "#fff", minHeight: "100vh", paddingTop: 96 }}>
      <ContactClient />
    </div>
  );
}
