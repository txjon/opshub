import Link from "next/link";

// 6-pillar services grid — image-first tiles with short labels.
// Mirrors Killer Merch's pattern: visuals carry the explanation,
// minimal text per tile. Real tile imagery replaces the gradient
// placeholders when assets are ready.

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
      padding: "100px 32px",
      background: "#fff",
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.12em",
            color: "#a0a0ad", marginBottom: 12,
          }}>
            What we do
          </div>
          <h2 style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#1a1a1a",
            maxWidth: 720,
          }}>
            Everything under one roof.
          </h2>
        </div>

        <div className="hpd-service-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}>
          {SERVICES.map(svc => (
            <Link key={svc.label} href={svc.href} style={{
              position: "relative",
              aspectRatio: "1 / 1",
              borderRadius: 12,
              overflow: "hidden",
              textDecoration: "none",
              display: "block",
              background: `linear-gradient(135deg, ${svc.tint} 0%, #0a0a0c 100%)`,
              transition: "transform 0.2s",
            }}
              className="hpd-service-tile"
            >
              {/* Subtle inner border for depth */}
              <div style={{
                position: "absolute", inset: 0,
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
              }} />
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "flex-end", justifyContent: "flex-start",
                padding: 24,
              }}>
                <div style={{
                  fontSize: 18, fontWeight: 800,
                  color: "#fff",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.2,
                }}>
                  {svc.label}
                  <span style={{
                    display: "block",
                    fontSize: 11, fontWeight: 600,
                    color: "rgba(255,255,255,0.5)",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    marginTop: 6,
                  }}>
                    Learn more →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .hpd-service-tile:hover {
          transform: translateY(-2px);
        }
        @media (max-width: 900px) {
          .hpd-service-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 540px) {
          .hpd-service-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
