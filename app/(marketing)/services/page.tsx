import { PageHero } from "../_components/PageHero";
import { SERVICE_IMAGES } from "../_components/_placeholder-images";

// Services page — deeper breakdown than the home page's 6-tile grid.
// Each service gets a 2-column row (photo + descriptive copy) so the
// page reads as a guided tour of what HPD does.

export const metadata = {
  title: "Services | House Party Distro",
  description: "Custom apparel printing, embroidery, product sourcing, warehousing, fulfillment, and e-commerce management. Everything under one roof.",
};

const SERVICES: {
  id: string;
  badge: string;
  name: string;
  description: string;
  capabilities: string[];
  stats?: { value: string; label: string }[];
  image: string;
}[] = [
  {
    id: "screen",
    badge: "Decoration",
    name: "Screen Printing",
    description: "Where ambitious brands come for prints other shops won't quote. Every ink type. Every specialty effect. Every detail handled by people who treat your art like you do.",
    capabilities: [],
    stats: [
      { value: "16", label: "Colors per location" },
      { value: "100", label: "Unit minimum" },
      { value: "All", label: "Specialty inks" },
    ],
    image: SERVICE_IMAGES["Screen Printing"],
  },
  {
    id: "embroidery",
    badge: "Decoration",
    name: "Embroidery",
    description: "Flat and 3D puff embroidery on hats, polos, jackets, and patches. Digitizing included so your logo translates cleanly to thread.",
    capabilities: ["Flat + 3D puff", "Hats, polos, jackets, patches", "Digitizing included", "Multi-position layouts"],
    image: SERVICE_IMAGES["Embroidery"],
  },
  {
    id: "sourcing",
    badge: "Sourcing",
    name: "Product Sourcing",
    description: "S&amp;S Activewear, AS Colour, LA Apparel, Next Level, Comfort Colors, and more. We pick the right product for your brand, budget, and end-use.",
    capabilities: ["Tier-1 vendors", "Premium + budget options", "Sustainable lines available", "Inventory-aware ordering"],
    image: SERVICE_IMAGES["Product Sourcing"],
  },
  {
    id: "design",
    badge: "Design",
    name: "Design &amp; Product Development",
    description: "From a napkin sketch to a finished product. Art direction, vector prep, mockups, sample rounds, and print-ready files. Every step reviewed through your client portal before anything hits press.",
    capabilities: ["Art direction + vector prep", "Mockup generation", "Sample rounds", "Proof approval portal"],
    image: SERVICE_IMAGES["Design"],
  },
  {
    id: "warehouse",
    badge: "Logistics",
    name: "Warehousing",
    description: "Our Las Vegas warehouse receives, inspects, and stores every unit before it ships. Quality check on every box.",
    capabilities: ["Las Vegas-based", "Per-unit QC", "Variance reporting", "Photo-documented receipts"],
    image: SERVICE_IMAGES["Warehousing"],
  },
  {
    id: "fulfillment",
    badge: "Logistics",
    name: "Fulfillment",
    description: "Pick, pack, and ship to your customers. Direct-to-consumer, batch event drops, or tour-route logistics. UPS, FedEx, USPS.",
    capabilities: ["DTC + batch shipping", "UPS / FedEx / USPS", "Shopify + ShipStation integrated", "Event-route logistics"],
    image: SERVICE_IMAGES["Fulfillment"],
  },
  {
    id: "ecommerce",
    badge: "E-Commerce",
    name: "E-Commerce Management",
    description: "Run your online store on infrastructure built for apparel brands. Shopify setup, product launches, inventory sync, and order routing, all wired into the same warehouse and fulfillment floor.",
    capabilities: ["Shopify storefront management", "Product launches + pre-orders", "Inventory sync", "Order routing + customer service"],
    image: SERVICE_IMAGES["E-Commerce"],
  },
];

const CLIENT_TYPES = [
  "Brands", "Tours & Artists", "Corporate", "Webstores", "Events", "Startups",
];

export default function ServicesPage() {
  return (
    <>
      <PageHero
        title="Everything under one roof."
        image="/marketing/hero-services.jpg"
      />

      {/* Service rows — alternating image/text sides for visual rhythm */}
      <section style={{ padding: "100px 32px", background: "#0a0a0c" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 80 }}>
          {SERVICES.map((svc, i) => (
            <article
              key={svc.id}
              id={svc.id}
              className="hpd-svc-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 56,
                alignItems: "center",
              }}
            >
              {/* Image — flips side on odd rows */}
              <div
                className="hpd-svc-img"
                style={{
                  order: i % 2 === 0 ? 0 : 1,
                  aspectRatio: "4 / 3",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#141417",
                }}
              >
                <img
                  src={svc.image}
                  alt=""
                  aria-hidden
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>

              <div>
                <h2
                  dangerouslySetInnerHTML={{ __html: svc.name }}
                  style={{
                    fontSize: "clamp(26px, 3.4vw, 36px)",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15,
                    color: "#fff",
                    marginBottom: 16,
                  }}
                />
                <p
                  dangerouslySetInnerHTML={{ __html: svc.description }}
                  style={{
                    fontSize: 16, lineHeight: 1.65,
                    color: "rgba(255,255,255,0.72)",
                    marginBottom: 20,
                  }}
                />
                {svc.stats ? (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${svc.stats.length}, 1fr)`,
                    gap: 24,
                    marginTop: 28,
                    paddingTop: 28,
                    borderTop: "1px solid rgba(255,255,255,0.1)",
                  }}>
                    {svc.stats.map(stat => (
                      <div key={stat.label}>
                        <div style={{
                          fontSize: "clamp(32px, 3.6vw, 48px)",
                          fontWeight: 800,
                          lineHeight: 1,
                          letterSpacing: "-0.02em",
                          color: "#fff",
                          marginBottom: 8,
                        }}>{stat.value}</div>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.14em",
                          color: "rgba(255,255,255,0.55)",
                          lineHeight: 1.3,
                        }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul style={{
                    listStyle: "none", padding: 0, margin: 0,
                    display: "grid", gridTemplateColumns: "1fr 1fr",
                    gap: "8px 16px",
                  }}>
                    {svc.capabilities.map(cap => (
                      <li key={cap} style={{
                        fontSize: 13, color: "rgba(255,255,255,0.6)",
                        paddingLeft: 16, position: "relative",
                      }}>
                        <span style={{
                          position: "absolute", left: 0, top: "0.5em",
                          width: 6, height: 6, background: "#fff", borderRadius: 99,
                        }} />
                        {cap}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Client types */}
      <section style={{ padding: "80px 32px 120px", background: "#0a0a0c", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.5)", marginBottom: 16,
          }}>
            Who we work with
          </div>
          <h2 style={{
            fontSize: "clamp(26px, 3.4vw, 36px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#fff",
            marginBottom: 40,
          }}>
            Brands. Tours. Corporates. Everyone in between.
          </h2>
          <div style={{
            display: "flex", flexWrap: "wrap", justifyContent: "center",
            gap: "16px 40px",
          }}>
            {CLIENT_TYPES.map(t => (
              <div key={t} style={{
                fontSize: 14, fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "rgba(255,255,255,0.85)",
              }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 800px) {
          .hpd-svc-row {
            grid-template-columns: 1fr !important;
            gap: 24px !important;
          }
          .hpd-svc-row .hpd-svc-img {
            order: 0 !important;
          }
        }
      `}</style>
    </>
  );
}
