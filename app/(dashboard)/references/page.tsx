"use client";
import { T, font } from "@/lib/theme";

// References — team-facing training docs + SOPs. Each artifact is a
// static HTML file in /public/ that opens in a new tab. The page is
// intentionally simple: title, short description, click → open.
//
// To add a new reference: drop the HTML file into /public/ and append
// an entry to REFERENCES below. No routing changes needed.

type Ref = { title: string; description: string; href: string };
type Section = { label: string; items: Ref[] };

const SECTIONS: Section[] = [
  {
    label: "Get Started",
    items: [
      {
        title: "Team Training Guide",
        description: "The full reference — every department, every page, every concept. Start here.",
        href: "/training-guide.html",
      },
    ],
  },
  {
    label: "Per-Role Playbooks",
    items: [
      {
        title: "Taylor — Setup",
        description: "Project setup, item building in Product Builder, art briefing in Art Studio, pre-order planning.",
        href: "/role-taylor.html",
      },
      {
        title: "Drake — Production",
        description: "Costing, quotes, proofs, invoicing, blanks, POs, production tracking, pre-order push-to-production.",
        href: "/role-drake.html",
      },
      {
        title: "Abigail — Ecomm",
        description: "Pre-order lifecycle, building products in Shopify, Shopify inventory entry, customer service lookups.",
        href: "/role-abigail.html",
      },
      {
        title: "Warehouse — Distro",
        description: "Receiving boxes, shipping ship-through projects, the 48h Shopify shelving window, silent mode.",
        href: "/role-warehouse.html",
      },
    ],
  },
  {
    label: "SOPs &amp; Workflows",
    items: [
      {
        title: "Pre-order SOP",
        description: "End-to-end workflow for pre-orders — roles, lifecycle phases, who does what at each stage.",
        href: "/preorder-sop.html",
      },
    ],
  },
];

export default function ReferencesPage() {
  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.02em" }}>References</h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 24 }}>
        SOPs and training docs. Click any card to open in a new tab.
      </p>

      {SECTIONS.map(section => (
        <div key={section.label} style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8,
          }}>
            {section.label.replace(/&amp;/g, "&")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {section.items.map(ref => (
              <a key={ref.href} href={ref.href} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "block", background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 10, padding: "12px 14px", textDecoration: "none",
                  color: T.text, transition: "border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>{ref.title}</div>
                <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{ref.description}</div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
