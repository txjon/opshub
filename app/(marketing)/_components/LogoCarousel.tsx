// Client logo strip. Killer Merch uses real partner logos for instant
// credibility. Text-stylized logos for v1 until real SVG/PNG assets land.
// When logos arrive, swap each entry from text to an <img>.

const LOGOS: string[] = [
  "CLEARED HOT",
  "LOW ROLLERS",
  "VIOLENTIA",
  "COASTAL GEAR",
  "DANCE CARD FULL",
  "GASLIGHT GROUP",
];

export function LogoCarousel() {
  return (
    <section style={{
      padding: "60px 32px",
      background: "#fff",
      borderTop: "1px solid #e0e0e4",
      borderBottom: "1px solid #e0e0e4",
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{
          fontSize: 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.14em",
          color: "#a0a0ad", marginBottom: 24, textAlign: "center",
        }}>
          Trusted by
        </div>
        <div className="hpd-logo-strip" style={{
          display: "flex", flexWrap: "wrap", justifyContent: "center",
          gap: 48, alignItems: "center",
        }}>
          {LOGOS.map(logo => (
            <span key={logo} style={{
              fontSize: 14, fontWeight: 800,
              color: "#d0d0d5",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}>
              {logo}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @media (max-width: 600px) {
          .hpd-logo-strip {
            gap: 24px !important;
          }
        }
      `}</style>
    </section>
  );
}
