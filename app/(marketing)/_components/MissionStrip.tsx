import Link from "next/link";

// Mission strip — the HPD signature line + a secondary CTA. Single
// statement (not the earlier triple-repeat); the repetition felt loud
// without adding meaning. CTA gives the section a clear action ramp
// when a visitor reaches the bottom of the home page.

export function MissionStrip() {
  return (
    <section style={{
      background: "#0a0a0c",
      color: "#fff",
      padding: "120px 32px",
      textAlign: "center",
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h2 style={{
          fontSize: "clamp(28px, 4.4vw, 52px)",
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          textTransform: "uppercase",
          marginBottom: 36,
        }}>
          Built for brands that move.<br />
          <span style={{ color: "#737380" }}>Based in Las Vegas. Shipped everywhere.</span>
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
  );
}
