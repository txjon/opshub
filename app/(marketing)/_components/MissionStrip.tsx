// Full-bleed mission strip — the HPD signature line. Killer Merch's
// equivalent is "WE DO COOL THINGS FOR COOL PEOPLE." This block is
// where HPD's voice gets loud. Final copy is placeholder until Jon
// locks in the brand line.

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
          fontSize: "clamp(32px, 5.5vw, 56px)",
          fontWeight: 900,
          lineHeight: 1.08,
          letterSpacing: "-0.02em",
          textTransform: "uppercase",
          marginBottom: 20,
        }}>
          Built for brands that move.<br />
          <span style={{ color: "#737380" }}>Printed in Las Vegas. Shipped everywhere.</span>
        </h2>
        <p style={{
          fontSize: 16,
          color: "rgba(255,255,255,0.6)",
          maxWidth: 640, margin: "0 auto",
          lineHeight: 1.6,
        }}>
          Quality, speed, and reliability — every order treated like our own brand depends on it.
        </p>
      </div>
    </section>
  );
}
