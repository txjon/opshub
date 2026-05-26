import Link from "next/link";

// Mission strip — the HPD signature line + a secondary CTA. Single
// statement (not the earlier triple-repeat); the repetition felt loud
// without adding meaning. CTA gives the section a clear action ramp
// when a visitor reaches the bottom of the home page.

export function MissionStrip() {
  return (
    <section style={{
      position: "relative",
      background: "#0a0a0c",
      color: "#fff",
      padding: "120px 32px",
      textAlign: "center",
      overflow: "hidden",
    }}>
      <img
        src="/marketing/mission-bg.jpg"
        alt=""
        aria-hidden
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%", objectFit: "cover",
        }}
      />
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.75) 100%)",
      }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto" }}>
        <h2 style={{
          fontSize: "clamp(28px, 4.4vw, 52px)",
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          textTransform: "uppercase",
          marginBottom: 16,
        }}>
          Built for brands that move.
        </h2>
        <p style={{
          fontSize: "clamp(16px, 1.6vw, 20px)",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
          marginBottom: 40,
        }}>
          Based in Las Vegas. Shipped everywhere.
        </p>

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
  );
}
