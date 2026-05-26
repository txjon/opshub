import { PageHero } from "../_components/PageHero";
import { SERVICE_IMAGES } from "../_components/_placeholder-images";

// Services page — deeper breakdown than the home page's 6-tile grid.
// Each service gets a 2-column row (photo + descriptive copy) so the
// page reads as a guided tour of what HPD does.

export const metadata = {
  title: "Services | House Party Distro",
  description: "Custom apparel decoration, product sourcing, warehousing, fulfillment, and e-commerce management. Screen printing and embroidery under one roof.",
};

const SERVICES: {
  id: string;
  badge: string;
  name: string;
  description: string;
  capabilities: string[];
  image: string;
}[] = [
  {
    id: "screen",
    badge: "Decoration",
    name: "Screen Printing",
    description: "The workhorse for runs of 48+. Water-based, plastisol, and discharge inks. Up to 8 colors per print location with full specialty options.",
    capabilities: ["Up to 8 colors", "Water-based + plastisol", "Discharge, puff, metallic, high-density", "Min 48 units"],
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
        eyebrow="What we do"
        title="Everything under one roof."
        sub="From a single run of 48 tees to a 5,000-unit tour package, every order gets the same attention to detail."
        image="/marketing/hero-services.jpg"
      />

      {/* Service rows — alternating image/text sides for visual rhythm */}
      <section style={{ padding: "100px 32px", background: "#fff" }}>
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
                  background: "#0a0a0c",
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
                <div style={{
                  fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.12em",
                  color: "#a0a0ad", marginBottom: 12,
                }}>{svc.badge}</div>
                <h2
                  dangerouslySetInnerHTML={{ __html: svc.name }}
                  style={{
                    fontSize: "clamp(26px, 3.4vw, 36px)",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15,
                    color: "#1a1a1a",
                    marginBottom: 16,
                  }}
                />
                <p
                  dangerouslySetInnerHTML={{ __html: svc.description }}
                  style={{
                    fontSize: 16, lineHeight: 1.65,
                    color: "#4a4a55",
                    marginBottom: 20,
                  }}
                />
                <ul style={{
                  listStyle: "none", padding: 0, margin: 0,
                  display: "grid", gridTemplateColumns: "1fr 1fr",
                  gap: "8px 16px",
                }}>
                  {svc.capabilities.map(cap => (
                    <li key={cap} style={{
                      fontSize: 13, color: "#6b6b78",
                      paddingLeft: 16, position: "relative",
                    }}>
                      <span style={{
                        position: "absolute", left: 0, top: "0.5em",
                        width: 6, height: 6, background: "#1a1a1a", borderRadius: 99,
                      }} />
                      {cap}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Client types pills */}
      <section style={{ padding: "80px 32px 100px", background: "#f8f8f9" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.14em",
            color: "#a0a0ad", marginBottom: 12,
          }}>
            Who we work with
          </div>
          <h2 style={{
            fontSize: "clamp(26px, 3.4vw, 36px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#1a1a1a",
            marginBottom: 32,
          }}>
            Brands. Tours. Corporates. Everyone in between.
          </h2>
          <div style={{
            display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12,
          }}>
            {CLIENT_TYPES.map(t => (
              <div key={t} style={{
                padding: "12px 24px",
                background: "#fff",
                border: "1px solid #e0e0e4",
                borderRadius: 99,
                fontSize: 14, fontWeight: 600,
                color: "#1a1a1a",
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
