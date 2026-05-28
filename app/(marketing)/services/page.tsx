import Link from "next/link";
import { PageHero } from "../_components/PageHero";
import { SERVICE_IMAGES } from "../_components/_placeholder-images";

// Services page.
//
// One continuous zig-zag of service rows (production + warehousing/
// fulfillment merged at the end), bracketed by an intro thesis line
// at the top and a Full Service capstone at the bottom. "Who we work
// with" closes the page.

export const metadata = {
  title: "Services | House Party Distro",
  description: "Custom apparel printing, embroidery, product sourcing, warehousing, fulfillment, and full-service brand operations under one roof.",
};

type Service = {
  id: string;
  badge: string;
  name: string;
  description: string;
  capabilities: string[];
  stats?: { value: string; label: string; valueImage?: string; valueImageAlt?: string }[];
  image: string;
};

const SERVICES: Service[] = [
  {
    id: "screen",
    badge: "Decoration",
    name: "Screen Printing",
    description: "The print serious brands build on. Ink cured into the fabric, color matched to spec, and built to outlast the drop it launched with. Quality that's noticed long after the season's over.",
    capabilities: [],
    stats: [
      { value: "16", label: "Color Capability" },
      { value: "High", label: "Volume" },
      { value: "Pantone", valueImage: "/marketing/pantone.svg", valueImageAlt: "Pantone", label: "Color matching" },
    ],
    image: SERVICE_IMAGES["Screen Printing"],
  },
  {
    id: "embroidery",
    badge: "Decoration",
    name: "Embroidery",
    description: "Stitched in, not stuck on. The premium touch for hats and high-end pieces. The kind of detail that earns a permanent spot in the rotation.",
    capabilities: [],
    stats: [
      { value: "Low", label: "Minimum" },
      { value: "Fast", label: "Turnaround" },
      { value: "Premium", label: "Finish" },
    ],
    image: SERVICE_IMAGES["Embroidery"],
  },
  {
    id: "sourcing",
    badge: "Sourcing",
    name: "Product Sourcing",
    description: "If it exists, we can source it. If it doesn't, we can build it. Top brand accounts for quick turnarounds, and overseas partners for everything else.",
    capabilities: [],
    stats: [
      { value: "In-stock", label: "Blanks" },
      { value: "Custom", label: "Available" },
      { value: "Global", label: "Network" },
    ],
    image: SERVICE_IMAGES["Product Sourcing"],
  },
  {
    id: "design",
    badge: "Design",
    name: "Design &amp; Product Development",
    description: "Direction starts with you. A reference, a mood board, a napkin sketch, even a half-baked idea. Point us toward your vision, we'll build it.",
    capabilities: [],
    stats: [
      { value: "Your", label: "Vision" },
      { value: "Our", label: "Execution" },
      { value: "Production", label: "Ready" },
    ],
    image: SERVICE_IMAGES["Design"],
  },
  {
    id: "warehousing-fulfillment",
    badge: "Logistics",
    name: "Warehousing &amp; Fulfillment",
    description: "Every unit logged, inspected, and tracked from the day it lands. Discrepancies get caught on our floor, not in your customer's hands. And when it ships, it ships right: fast, accurate, and on-brand, because fulfillment is your brand's last impression, not a commodity.",
    capabilities: [],
    stats: [
      { value: "Secure", label: "Storage" },
      { value: "Real-time", label: "Tracking" },
      { value: "High", label: "Volume" },
    ],
    image: SERVICE_IMAGES["Fulfillment"],
  },
];

export default function ServicesPage() {
  return (
    <>
      <PageHero
        title="Everything under one roof."
        image="/marketing/hero-services.jpg"
        minHeight="min(72vh, 720px)"
      />

      {/* Thesis — introduces the manufacturing core. */}
      <ConnectiveLine>
        Focus on your brand. We'll handle the rest.
        <br />
        Every step between your idea and your customer's
        <br />
        new favorite piece.
      </ConnectiveLine>

      {/* All services as one continuous zig-zag — production work plus
          the merged warehousing & fulfillment row at the end. */}
      <ServiceGroup services={SERVICES} />

      {/* Closing hero — full-bleed photo with the partnership statement.
          Same scale as the top hero, no nav-clearance padding since
          we're at the bottom of the page. */}
      <section style={{
        position: "relative",
        minHeight: "min(72vh, 720px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        textAlign: "center",
      }}>
        <img
          src="/marketing/hero-services2.jpg"
          alt=""
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover",
          }}
        />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.75) 100%)",
        }} />
        <div style={{
          position: "relative", zIndex: 1,
          maxWidth: 1000, padding: "80px 32px",
        }}>
          <h2 style={{
            fontSize: "clamp(32px, 5.5vw, 60px)",
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "#fff",
            textTransform: "uppercase",
            marginBottom: 36,
          }}>
            One partner, from your idea to the last shipment.
          </h2>
          <Link href="/start" style={{
            display: "inline-block",
            background: "#fff", color: "#0a0a0c",
            padding: "16px 36px", borderRadius: 8,
            fontSize: 14, fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            textDecoration: "none",
          }}>
            Start a Project
          </Link>
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

// Centered connective prose bridging service groups. Reads as a
// transition beat, not a content block.
function ConnectiveLine({ children }: { children: React.ReactNode }) {
  return (
    <section style={{
      padding: "80px 32px",
      background: "#0a0a0c",
      textAlign: "center",
    }}>
      <p style={{
        fontSize: "clamp(20px, 2.2vw, 28px)",
        lineHeight: 1.4,
        letterSpacing: "-0.01em",
        color: "rgba(255,255,255,0.92)",
        maxWidth: 820, margin: "0 auto",
        fontWeight: 500,
      }}>
        {children}
      </p>
    </section>
  );
}

// Group renderer — maps service rows with alternating image side.
// Used for MAKE IT (production services, big crafted photo boxes).
function ServiceGroup({ services }: { services: Service[] }) {
  return (
    <section style={{ padding: "0 32px 40px", background: "#0a0a0c" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 80 }}>
        {services.map((svc, i) => <ServiceRow key={svc.id} svc={svc} index={i} />)}
      </div>
    </section>
  );
}

function ServiceRow({ svc, index }: { svc: Service; index: number }) {
  return (
    <article
      id={svc.id}
      className="hpd-svc-row"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div
        className="hpd-svc-img"
        style={{
          order: index % 2 === 0 ? 0 : 1,
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
              <div key={stat.label} style={{ textAlign: "center" }}>
                {stat.valueImage ? (
                  <div style={{
                    height: "clamp(24px, 2.6vw, 34px)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 10,
                  }}>
                    <img
                      src={stat.valueImage}
                      alt={stat.valueImageAlt || stat.value}
                      style={{
                        height: "100%",
                        maxWidth: "100%",
                        width: "auto",
                        display: "block",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                ) : (
                  <div style={{
                    fontSize: "clamp(24px, 2.6vw, 34px)",
                    fontWeight: 800,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    color: "#fff",
                    marginBottom: 10,
                  }}>{stat.value}</div>
                )}
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
  );
}
