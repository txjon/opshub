import Image from "next/image";
import Link from "next/link";
import { SERVICE_IMAGES } from "../_components/_placeholder-images";

// /services — photo-led service rows (Oct 2026, AKT direction). Brought
// back from the Sep retirement in a form that says almost nothing: each
// service is a huge name + one line of offerings beside a photo, rows
// alternating sides and black/white blocks. The photos do the selling;
// /start does the talking.

export const metadata = {
  title: "Services | House Party Distro",
  description: "Merch production, custom products, cut-and-sew, e-commerce and creative services.",
};

const SERVICES: { name: string; offerings: string[]; image: string }[] = [
  { name: "Merch Production",   offerings: ["Screen printing", "Embroidery", "Finishing"],                       image: SERVICE_IMAGES["Screen Printing"] },
  { name: "Custom Products",    offerings: ["Accessories", "Promotional products"],                               image: SERVICE_IMAGES["Product Sourcing"] },
  { name: "Custom Cut-and-Sew", offerings: ["Design & development", "Sampling", "Finishing"],                     image: SERVICE_IMAGES["Embroidery"] },
  { name: "E-Commerce",         offerings: ["Online store design", "Inventory management", "Fulfillment"],        image: SERVICE_IMAGES["Fulfillment"] },
  { name: "Creative Services",  offerings: ["Art direction", "Product development"],                              image: SERVICE_IMAGES["Design"] },
]; image: string }[] = [
  { name: "Screen Printing",           offerings: ["Tees", "Fleece", "Bags", "Specialty inks"],              image: SERVICE_IMAGES["Screen Printing"] },
  { name: "Embroidery",                offerings: ["Headwear", "Patches", "Polos", "Outerwear"],             image: SERVICE_IMAGES["Embroidery"] },
  { name: "Product Sourcing",          offerings: ["Blanks", "Premium brands", "Custom accessories"],        image: SERVICE_IMAGES["Product Sourcing"] },
  { name: "Design & Development",      offerings: ["Design", "Mockups", "Samples", "Labels & tags"],         image: SERVICE_IMAGES["Design"] },
  { name: "Warehousing & Fulfillment", offerings: ["Storage", "Webstores", "Pick & pack", "Shipping"],       image: SERVICE_IMAGES["Fulfillment"] },
];

export default function ServicesPage() {
  return (
    <>
      {/* Nav is a fixed overlay; this band gives it a black backdrop. */}
      <div style={{ height: 96, background: "#0a0a0c" }} />

      {SERVICES.map((s, i) => {
        const dark = i % 2 === 0;
        return (
          <section key={s.name} className={`hpd-svc-row${i % 2 ? " hpd-svc-flip" : ""}`}>
            <div className="hpd-svc-text" style={{
              background: dark ? "#0a0a0c" : "#fff",
              color: dark ? "#fff" : "#0a0a0c",
            }}>
              <h2 className="hpd-svc-name">{s.name}</h2>
              <div className="hpd-svc-offer">{s.offerings.join(" • ")}</div>
            </div>
            <div className="hpd-svc-photo">
              <Image src={s.image} alt={s.name} fill sizes="(max-width: 800px) 100vw, 50vw" style={{ objectFit: "cover" }} />
            </div>
          </section>
        );
      })}

      <section style={{ background: "#0a0a0c", color: "#fff", padding: "100px 32px", textAlign: "center" }}>
        <Link href="/start" style={{
          display: "inline-block",
          background: "#fff", color: "#0a0a0c",
          padding: "18px 36px",
          fontSize: 14, fontWeight: 800,
          letterSpacing: "0.12em", textTransform: "uppercase",
          textDecoration: "none",
        }}>
          Start a Project
        </Link>
      </section>

      <style>{`
        .hpd-svc-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: max(420px, 32vw);
        }
        .hpd-svc-flip .hpd-svc-text { order: 2; }
        .hpd-svc-text {
          display: flex; flex-direction: column; justify-content: center;
          padding: 48px clamp(32px, 4vw, 64px);
        }
        .hpd-svc-name {
          font-size: clamp(40px, 5.6vw, 88px);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: -0.02em;
          line-height: 0.95;
          margin: 0 0 16px;
        }
        .hpd-svc-offer {
          font-size: 13px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.08em;
          opacity: 0.85;
        }
        .hpd-svc-photo { position: relative; min-height: 320px; background: #0a0a0c; }
        @media (max-width: 800px) {
          .hpd-svc-row { grid-template-columns: 1fr; min-height: 0; }
          .hpd-svc-flip .hpd-svc-text { order: 0; }
          .hpd-svc-photo { aspect-ratio: 4 / 3; min-height: 0; }
          .hpd-svc-text { padding: 40px 20px; }
          .hpd-svc-offer { font-size: 12px; }
        }
      `}</style>
    </>
  );
}
