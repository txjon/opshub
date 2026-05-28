"use client";
import Link from "next/link";
import { useState } from "react";

// Public marketing footer. Multi-column layout — menu, more info, social,
// branding — matching the Killer Merch footer pattern.

const FOOTER_MENU: { label: string; href: string; external?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Start a Project", href: "/start" },
  { label: "Contact", href: "/contact" },
  { label: "Client Portal", href: "/client-portal" },
  { label: "Shop", href: "/shop" },
];

const FOOTER_SOCIAL: { label: string; href: string }[] = [
  { label: "Instagram", href: "https://instagram.com/housepartydistro" },
];

type LegalKey = "privacy" | "terms";

export function MarketingFooter() {
  const [openModal, setOpenModal] = useState<LegalKey | null>(null);

  return (
    <footer style={{
      background: "#0a0a0c", borderTop: "1px solid rgba(255,255,255,0.08)",
      padding: "60px 32px 32px",
      color: "#fff",
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 1fr 1fr",
          gap: 48, marginBottom: 48,
        }} className="hpd-footer-grid">
          {/* Brand column */}
          <div>
            <img
              src="/marketing/hpd-logo.svg"
              alt="House Party Distro"
              style={{ height: 22, width: "auto", display: "block", marginBottom: 14 }}
            />
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
              Custom apparel from concept to delivery.<br />
              Las Vegas, NV
            </div>
          </div>

          {/* Menu */}
          <FooterColumn label="Menu">
            {FOOTER_MENU.map(link => (
              link.external ? (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                  style={footerLinkStyle}>{link.label}</a>
              ) : (
                <Link key={link.href} href={link.href} style={footerLinkStyle}>{link.label}</Link>
              )
            ))}
          </FooterColumn>

          {/* More info — Privacy + Terms open as modals */}
          <FooterColumn label="More Info">
            <button type="button" onClick={() => setOpenModal("privacy")} style={footerButtonStyle}>Privacy</button>
            <button type="button" onClick={() => setOpenModal("terms")} style={footerButtonStyle}>Terms</button>
          </FooterColumn>

          {/* Social */}
          <FooterColumn label="Social">
            {FOOTER_SOCIAL.map(link => (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                style={footerLinkStyle}>{link.label}</a>
            ))}
          </FooterColumn>
        </div>

        {/* Bottom bar */}
        <div style={{
          paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            © {new Date().getFullYear()} House Party Distro
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Built in Las Vegas
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .hpd-footer-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 32px !important;
          }
          .hpd-footer-grid > :first-child {
            grid-column: 1 / -1;
          }
        }
      `}</style>

      {openModal && (
        <LegalModal which={openModal} onClose={() => setOpenModal(null)} />
      )}
    </footer>
  );
}

function FooterColumn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)",
        textTransform: "uppercase", letterSpacing: "0.14em",
        marginBottom: 16,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function LegalModal({ which, onClose }: { which: LegalKey; onClose: () => void }) {
  const meta = which === "privacy"
    ? { title: "Privacy Policy", body: PRIVACY_BODY }
    : { title: "Terms of Service", body: TERMS_BODY };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff",
          color: "#1a1a1a",
          borderRadius: 14,
          width: "min(760px, 100%)",
          maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{
          padding: "22px 28px",
          borderBottom: "1px solid #e0e0e4",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <h2 style={{
            fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em",
            color: "#1a1a1a",
          }}>{meta.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "#6b6b78", padding: 4, fontSize: 22, lineHeight: 1,
            }}
          >×</button>
        </div>
        <div style={{
          padding: "24px 28px",
          overflowY: "auto",
          fontSize: 14, lineHeight: 1.7, color: "#4a4a55",
          whiteSpace: "pre-wrap",
        }}>
          {meta.body}
        </div>
        <div style={{
          padding: "16px 28px",
          borderTop: "1px solid #e0e0e4",
          fontSize: 11, color: "#a0a0ad",
        }}>
          Last updated {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
        </div>
      </div>
    </div>
  );
}

const footerLinkStyle: React.CSSProperties = {
  fontSize: 13, color: "rgba(255,255,255,0.78)", textDecoration: "none", lineHeight: 1.4,
};

const footerButtonStyle: React.CSSProperties = {
  fontSize: 13, color: "rgba(255,255,255,0.78)", textDecoration: "none", lineHeight: 1.4,
  background: "transparent", border: "none", padding: 0,
  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
};

// Placeholder copy. Plain text, displayed with whiteSpace: pre-wrap. Edit
// these strings to update the modal content. Legal review recommended
// before launch.
const PRIVACY_BODY = `House Party Distro respects your privacy. This policy explains what we collect, how we use it, and the rights you have over your information.

WHAT WE COLLECT
When you submit an intake form, request a quote, or work with us on a project, we collect contact details (name, company, email, phone), project information you choose to share, and any files you upload (artwork, references, tech packs).

HOW WE USE IT
We use this information only to evaluate, quote, produce, and ship your project. We share it with third parties (decoration partners, blank suppliers, shipping carriers, payment processors) strictly as needed to fulfill the work you've requested.

STORAGE
Project data and uploaded files are stored on US-based infrastructure (Supabase, Google Drive). Access is limited to House Party Distro staff and our subprocessors. Files associated with abandoned intake submissions are automatically deleted after 24 hours.

YOUR RIGHTS
You can request a copy of, correction to, or deletion of your information at any time by emailing privacy@housepartydistro.com. We'll respond within 30 days.

THIRD-PARTY SITES
Our site links to external services (our Shopify storefront, social platforms). Their privacy policies apply when you visit them.

UPDATES
We may update this policy as our practices evolve. Material changes will be reflected in the "Last updated" date above.

Questions: privacy@housepartydistro.com`;

const TERMS_BODY = `These terms govern your use of housepartydistro.com and any services provided by House Party Distro ("HPD"). By submitting an intake form or engaging us for a project, you agree to these terms.

OUR SERVICE
HPD provides custom apparel production: design, sourcing, printing, embroidery, warehousing, and fulfillment. Specific deliverables, timelines, and pricing are defined per project in a written quote.

QUOTES & PAYMENT
Quotes are valid for 30 days unless stated otherwise. Production begins after quote approval and any required deposit is received. Payment terms (deposit, net, prepaid) are agreed in writing per project.

PRODUCTION & TIMING
Production timelines are estimates based on current capacity and material availability. We work to ship by your target date but do not guarantee specific dates unless explicitly contracted in writing.

ARTWORK & INTELLECTUAL PROPERTY
You retain ownership of artwork, logos, and brand assets you provide to us. You grant HPD a limited license to reproduce them solely to fulfill your project. HPD retains ownership of internal tools, processes, and templates used to produce your work.

QUALITY & RESPONSIBILITY
We produce to industry-standard tolerances. Variations in placement, color, and fabric are inherent to custom apparel and not considered defects within those tolerances. Notify us within 14 days of receipt of any production issue.

LIMITATION OF LIABILITY
HPD's total liability for any project is limited to the amount you paid for that project. We are not liable for indirect, incidental, or consequential damages.

GOVERNING LAW
These terms are governed by the laws of the State of Nevada. Any dispute will be resolved in the courts of Clark County, Nevada.

UPDATES
We may update these terms. The "Last updated" date above reflects the most recent revision.

Questions: hello@housepartydistro.com`;
