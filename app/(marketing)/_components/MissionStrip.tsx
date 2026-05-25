// Mission strip — Killer Merch repeats their values line three times as
// a signature visual. Each repetition reinforces the same idea. Final
// HPD signature line still TBD; placeholder copy below.

const MANTRA = "Built for brands that move. Printed in Las Vegas. Shipped everywhere.";

export function MissionStrip() {
  return (
    <section style={{
      background: "#0a0a0c",
      color: "#fff",
      padding: "100px 32px",
      textAlign: "center",
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Three repetitions of the signature line, each step softer.
            Mirrors Killer Merch's repeated mantra rhythm. */}
        {[1, 0.55, 0.25].map((opacity, i) => (
          <div key={i} style={{
            fontSize: "clamp(22px, 3.6vw, 40px)",
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
            opacity,
            marginBottom: i < 2 ? 18 : 0,
          }}>
            {MANTRA}
          </div>
        ))}
      </div>
    </section>
  );
}
