import Link from "next/link";

// Service grid — Killer Merch style: 2-column rectangular tiles,
// image-first, label overlaid bottom-left. Each tile is its own
// photographic statement. Real imagery replaces placeholders later.

const SERVICES: { label: string; href: string; tint: string }[] = [
  { label: "Design & Art",     href: "/services#design",     tint: "#2a3d50" },
  { label: "Screen Printing",  href: "/services#screen",     tint: "#1f1f1f" },
  { label: "Embroidery",       href: "/services#embroidery", tint: "#4a3a2a" },
  { label: "Blank Sourcing",   href: "/services#blanks",     tint: "#2a4a3a" },
  { label: "Warehousing",      href: "/services#warehouse",  tint: "#3a2a4a" },
  { label: "Fulfillment",      href: "/services#fulfillment",tint: "#4a2a3a" },
];

export function ServiceGrid() {
  return (
    <section style={{
      padding: "0",
      background: "#fff",
    }}>
      <div className="hpd-service-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 0,
      }}>
        {SERVICES.map(svc => (
          <Link key={svc.label} href={svc.href} style={{
            position: "relative",
            aspectRatio: "3 / 2",
            overflow: "hidden",
            textDecoration: "none",
            display: "block",
            background: `linear-gradient(140deg, ${svc.tint} 0%, #0a0a0c 100%)`,
          }}
            className="hpd-service-tile"
          >
            {/* Overlay gradient for text legibility */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.2) 100%)",
              transition: "opacity 0.25s",
            }} className="hpd-service-overlay" />
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "flex-end", justifyContent: "flex-start",
              padding: "32px 36px",
            }}>
              <div>
                <div style={{
                  fontSize: "clamp(22px, 2.4vw, 32px)",
                  fontWeight: 900,
                  color: "#fff",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.1,
                  textTransform: "uppercase",
                }}>
                  {svc.label}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: "rgba(255,255,255,0.6)",
                  textTransform: "uppercase", letterSpacing: "0.12em",
                  marginTop: 8,
                }}>
                  Learn more →
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .hpd-service-tile:hover .hpd-service-overlay {
          opacity: 0.5;
        }
        @media (max-width: 700px) {
          .hpd-service-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
