// 4-step process visual. HPD's differentiator vs Killer Merch — they don't
// surface this. Keeps the customer oriented through the project lifecycle.

const STEPS: { n: string; label: string; desc: string }[] = [
  { n: "01", label: "Submit",      desc: "Tell us what you need: items, quantities, artwork, timeline." },
  { n: "02", label: "Quote & Approve", desc: "Detailed quote with mockups. Approve from your client portal." },
  { n: "03", label: "Production",  desc: "We source blanks, send to decorators, track every item through production." },
  { n: "04", label: "Delivery",    desc: "Direct to your customer, to our warehouse for QC, or staged for fulfillment." },
];

export function ProcessFlow() {
  return (
    <section style={{
      padding: "100px 32px",
      background: "#f8f8f9",
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.12em",
            color: "#a0a0ad", marginBottom: 12,
          }}>
            How it works
          </div>
          <h2 style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#1a1a1a",
            maxWidth: 720,
          }}>
            Four steps from idea to delivery.
          </h2>
        </div>

        <div className="hpd-process" style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
        }}>
          {STEPS.map((step, i) => (
            <div key={step.n} style={{
              padding: "28px 24px",
              background: "#fff",
              border: "1px solid #e0e0e4",
              borderRight: i === STEPS.length - 1 ? "1px solid #e0e0e4" : "none",
              borderRadius:
                i === 0 ? "12px 0 0 12px"
                : i === STEPS.length - 1 ? "0 12px 12px 0"
                : 0,
              position: "relative",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800,
                color: "#a0a0ad",
                letterSpacing: "0.1em",
                marginBottom: 10,
              }}>
                {step.n}
              </div>
              <div style={{
                fontSize: 17, fontWeight: 800,
                color: "#1a1a1a",
                marginBottom: 6,
                letterSpacing: "-0.01em",
              }}>
                {step.label}
              </div>
              <div style={{
                fontSize: 13, color: "#6b6b78",
                lineHeight: 1.5,
              }}>
                {step.desc}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  position: "absolute",
                  right: -10, top: "50%",
                  transform: "translateY(-50%)",
                  width: 20, height: 20,
                  background: "#f8f8f9",
                  borderRadius: 99,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: "#c0c0c5",
                  zIndex: 1,
                }}
                  className="hpd-process-arrow"
                >
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .hpd-process {
            grid-template-columns: 1fr 1fr !important;
            gap: 12px !important;
          }
          .hpd-process > div {
            border-radius: 12px !important;
            border-right: 1px solid #e0e0e4 !important;
          }
          .hpd-process-arrow {
            display: none !important;
          }
        }
        @media (max-width: 540px) {
          .hpd-process {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
