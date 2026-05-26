import { PageHero } from "../_components/PageHero";
import { WORK_IMAGES } from "../_components/_placeholder-images";

// /work — extended portfolio grid. Twelve items v1, hardcoded. Can
// graduate to a `portfolio_items` table + admin UI later.

export const metadata = {
  title: "Work | House Party Distro",
  description: "Recent custom apparel and merch projects across tours, brands, corporate, and webstore drops.",
};

const ITEMS: { title: string; type: string; items: number; units: number }[] = [
  { title: "Festival Collection",       type: "Tour Merch", items: 12, units: 2400 },
  { title: "Corporate Staff Polos",     type: "Corporate",  items: 4,  units: 500  },
  { title: "Album Release Drop",        type: "Brand",      items: 8,  units: 1200 },
  { title: "Webstore Restock",          type: "Webstore",   items: 6,  units: 3000 },
  { title: "Tour Merch 2026",           type: "Tour",       items: 15, units: 5000 },
  { title: "Promo Giveaway",            type: "Corporate",  items: 2,  units: 300  },
  { title: "Summer Capsule",            type: "Brand",      items: 6,  units: 800  },
  { title: "Festival Crew Uniforms",    type: "Corporate",  items: 3,  units: 250  },
  { title: "Charity Run Tee",           type: "Event",      items: 1,  units: 600  },
  { title: "Limited Edition Hoodies",   type: "Brand",      items: 4,  units: 1500 },
  { title: "Conference Swag Pack",      type: "Corporate",  items: 5,  units: 400  },
  { title: "Co-Branded Drop",           type: "Brand",      items: 7,  units: 950  },
];

export default function WorkPage() {
  return (
    <>
      <PageHero
        eyebrow="Selected work"
        title="Built for brands that move."
        sub="A snapshot of recent runs across tours, brand drops, corporate gifts, and ongoing webstore inventory."
      />

      <section style={{ padding: "80px 32px 120px", background: "#fff" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div className="hpd-work-grid" style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
          }}>
            {ITEMS.map((item, i) => (
              <article
                key={item.title}
                className="hpd-work-tile"
                style={{
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#fff",
                  border: "1px solid #e0e0e4",
                  display: "flex", flexDirection: "column",
                  transition: "border-color 0.2s, transform 0.2s",
                }}
              >
                <div style={{
                  aspectRatio: "4 / 3",
                  background: "#0a0a0c",
                  overflow: "hidden",
                }}>
                  <img
                    src={WORK_IMAGES[i % WORK_IMAGES.length]}
                    alt=""
                    aria-hidden
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </div>
                <div style={{ padding: "18px 20px" }}>
                  <div style={{
                    fontSize: 16, fontWeight: 700,
                    color: "#1a1a1a", marginBottom: 6,
                    letterSpacing: "-0.01em",
                  }}>
                    {item.title}
                  </div>
                  <div style={{
                    fontSize: 12, color: "#6b6b78",
                    display: "flex", alignItems: "center", gap: 8,
                    flexWrap: "wrap",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      color: "#1a1a1a",
                      background: "#f3f3f5",
                      padding: "3px 8px", borderRadius: 4,
                    }}>
                      {item.type}
                    </span>
                    <span>{item.items} items</span>
                    <span style={{ color: "#d0d0d5" }}>·</span>
                    <span>{item.units.toLocaleString()} units</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA strip */}
      <section style={{
        background: "#0a0a0c",
        color: "#fff",
        padding: "80px 32px",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{
            fontSize: "clamp(24px, 3vw, 32px)",
            fontWeight: 900,
            letterSpacing: "-0.02em",
            marginBottom: 12,
            textTransform: "uppercase",
          }}>
            Got a project in mind?
          </h2>
          <p style={{
            fontSize: 15, color: "rgba(255,255,255,0.7)",
            marginBottom: 28, lineHeight: 1.6,
          }}>
            Tell us what you need. We&apos;ll send back a detailed quote with mockups.
          </p>
          <a href="/start" style={{
            display: "inline-block",
            color: "#fff",
            fontSize: 13, fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            textDecoration: "none",
            borderBottom: "2px solid #fff",
            paddingBottom: 4,
          }}>
            Start a Project
          </a>
        </div>
      </section>

      <style>{`
        .hpd-work-tile:hover {
          border-color: #1a1a1a;
          transform: translateY(-2px);
        }
        @media (max-width: 900px) {
          .hpd-work-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 540px) {
          .hpd-work-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
