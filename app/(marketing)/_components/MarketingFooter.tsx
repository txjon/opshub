import Link from "next/link";

// Public marketing footer. Multi-column layout — menu, more info, social,
// branding — matching the Killer Merch footer pattern. Address, copyright,
// and a small Team Login link for the OpsHub crew.

const FOOTER_MENU: { label: string; href: string; external?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Start a Project", href: "/start" },
  { label: "Client Portal", href: "/client-portal" },
  { label: "Shop", href: "https://shop.housepartydistro.com", external: true },
];

const FOOTER_INFO: { label: string; href: string }[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const FOOTER_SOCIAL: { label: string; href: string }[] = [
  { label: "Instagram", href: "https://instagram.com/housepartydistro" },
  { label: "Twitter", href: "https://twitter.com/housepartydistro" },
];

export function MarketingFooter() {
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
            <div style={{
              fontSize: 16, fontWeight: 900, letterSpacing: "-0.02em",
              marginBottom: 12, color: "#fff",
              textTransform: "uppercase",
            }}>
              house party distro
            </div>
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

          {/* More info */}
          <FooterColumn label="More Info">
            {FOOTER_INFO.map(link => (
              <Link key={link.href} href={link.href} style={footerLinkStyle}>{link.label}</Link>
            ))}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

const footerLinkStyle: React.CSSProperties = {
  fontSize: 13, color: "rgba(255,255,255,0.78)", textDecoration: "none", lineHeight: 1.4,
};
