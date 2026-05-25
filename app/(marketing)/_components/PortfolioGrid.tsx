import Link from "next/link";

// Portfolio teaser — 6 standout projects with project type + units.
// Richer than Killer Merch's logo-only credibility play. Hardcoded
// for v1; can graduate to a `portfolio_items` table later.

const ITEMS: { title: string; type: string; meta: string; tint: string }[] = [
  { title: "Festival Collection",   type: "Tour Merch",  meta: "12 items · 2,400 units", tint: "#3a2a4a" },
  { title: "Corporate Staff Polos", type: "Corporate",   meta: "4 items · 500 units",    tint: "#2a3d50" },
  { title: "Album Release Drop",    type: "Brand",       meta: "8 items · 1,200 units",  tint: "#4a2a3a" },
  { title: "Webstore Restock",      type: "Webstore",    meta: "6 items · 3,000 units",  tint: "#2a4a3a" },
  { title: "Tour Merch 2026",       type: "Tour",        meta: "15 items · 5,000 units", tint: "#4a3a2a" },
  { title: "Promo Giveaway",        type: "Corporate",   meta: "2 items · 300 units",    tint: "#1f1f1f" },
];

export function PortfolioGrid({ showCta = true }: { showCta?: boolean }) {
  return (
    <section style={{
      padding: "100px 32px",
      background: "#f8f8f9",
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 32,
          flexWrap: "wrap",
          gap: 16,
        }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.12em",
              color: "#a0a0ad", marginBottom: 12,
            }}>
              Recent work
            </div>
            <h2 style={{
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: "#1a1a1a",
              maxWidth: 720,
            }}>
              Built for brands that move.
            </h2>
          </div>
          {showCta && (
            <Link href="/work" style={{
              fontSize: 14, fontWeight: 700,
              color: "#1a1a1a", textDecoration: "none",
              borderBottom: "2px solid #1a1a1a",
              paddingBottom: 2,
            }}>
              See all work →
            </Link>
          )}
        </div>

        <div className="hpd-portfolio-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}>
          {ITEMS.map(item => (
            <div key={item.title} style={{
              borderRadius: 12, overflow: "hidden",
              background: "#fff",
              border: "1px solid #e0e0e4",
              display: "flex", flexDirection: "column",
            }}>
              {/* Image placeholder */}
              <div style={{
                aspectRatio: "4 / 3",
                background: `linear-gradient(135deg, ${item.tint} 0%, #0a0a0c 100%)`,
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: "rgba(255,255,255,0.3)",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Project Photo
                </div>
              </div>
              <div style={{ padding: "16px 18px" }}>
                <div style={{
                  fontSize: 15, fontWeight: 700,
                  color: "#1a1a1a", marginBottom: 4,
                  letterSpacing: "-0.01em",
                }}>
                  {item.title}
                </div>
                <div style={{
                  fontSize: 12, color: "#6b6b78",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span>{item.type}</span>
                  <span style={{ color: "#d0d0d5" }}>·</span>
                  <span>{item.meta.split(" · ")[0]}</span>
                  <span style={{ color: "#d0d0d5" }}>·</span>
                  <span>{item.meta.split(" · ")[1]}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .hpd-portfolio-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 540px) {
          .hpd-portfolio-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
