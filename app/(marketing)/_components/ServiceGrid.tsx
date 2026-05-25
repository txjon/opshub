import Link from "next/link";
import { SERVICE_IMAGES } from "./_placeholder-images";

// Service grid — Killer Merch style: 2-column rectangular tiles,
// image-first, label overlaid bottom-left. Each tile is its own
// photographic statement.

const SERVICES: { label: string; href: string }[] = [
  { label: "Design & Art",     href: "/services#design"     },
  { label: "Screen Printing",  href: "/services#screen"     },
  { label: "Embroidery",       href: "/services#embroidery" },
  { label: "Blank Sourcing",   href: "/services#blanks"     },
  { label: "Warehousing",      href: "/services#warehouse"  },
  { label: "Fulfillment",      href: "/services#fulfillment"},
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
            background: "#0a0a0c",
          }}
            className="hpd-service-tile"
          >
            {/* Background photo */}
            <img
              src={SERVICE_IMAGES[svc.label]}
              alt=""
              aria-hidden
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%", objectFit: "cover",
                transition: "transform 0.4s",
              }}
              className="hpd-service-img"
            />
            {/* Overlay gradient for text legibility */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.25) 100%)",
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
        .hpd-service-tile:hover .hpd-service-img {
          transform: scale(1.04);
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
