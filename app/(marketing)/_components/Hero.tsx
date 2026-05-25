import Link from "next/link";

// Full-bleed hero with overlay text. Killer-Merch-inspired: dark image
// background, bold uppercase headline, single CTA. Placeholder gradient
// stays until Jon provides real hero photography.

export function Hero() {
  return (
    <section style={{
      position: "relative",
      minHeight: 640,
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start",
      overflow: "hidden",
    }}>
      {/* Background — gradient placeholder until real hero image lands.
          The radial gradient mimics a backlit subject; the linear darkens
          the bottom for text contrast. */}
      <div style={{
        position: "absolute", inset: 0,
        background: `
          linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.65) 100%),
          radial-gradient(ellipse at 30% 30%, #3a3a4a 0%, #1a1a1f 60%, #050507 100%)
        `,
      }} />

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 1280, margin: "0 auto", width: "100%",
        padding: "120px 32px",
      }}>
        <div style={{ maxWidth: 760 }}>
          <h1 style={{
            fontSize: "clamp(38px, 7vw, 68px)",
            fontWeight: 900,
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            color: "#fff",
            textTransform: "uppercase",
            marginBottom: 24,
          }}>
            Custom apparel.<br />
            <span style={{ color: "#b0b0b8" }}>From concept to delivery.</span>
          </h1>
          <p style={{
            fontSize: 18, lineHeight: 1.5,
            color: "rgba(255,255,255,0.85)",
            maxWidth: 560,
            marginBottom: 32,
          }}>
            We handle every step — art production, blank sourcing, decoration, warehousing, and fulfillment. You focus on your brand.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/start" style={{
              display: "inline-block",
              background: "#fff", color: "#1a1a1a",
              padding: "15px 32px", borderRadius: 8,
              fontSize: 15, fontWeight: 700,
              textDecoration: "none",
            }}>
              Start a Project →
            </Link>
            <Link href="/work" style={{
              display: "inline-block",
              background: "transparent", color: "#fff",
              padding: "15px 32px", borderRadius: 8,
              fontSize: 15, fontWeight: 700,
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.3)",
            }}>
              See our work
            </Link>
          </div>
          <div style={{
            fontSize: 12, color: "rgba(255,255,255,0.5)",
            marginTop: 24,
            letterSpacing: "0.04em",
          }}>
            Las Vegas, NV — serving brands, tours, and corporate clients nationwide
          </div>
        </div>
      </div>
    </section>
  );
}
