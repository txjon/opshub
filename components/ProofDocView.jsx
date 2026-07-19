// ProofDocView — the read-only V2 web proof. Renders purely from a
// self-contained items.proof_spec (+ a mockup URL + client/item names), so it
// works with NO costing access. One source for: the ProofModal editor preview,
// the internal proofs-tab "View proof", and the client portal.
//
// Expected `spec` shape (baked by ArtTab buildSpec):
//   { locations:[{placement,sizeText,colors:[{name,hex}],callout,specialties:[]}],
//     methods:[], notes, finishing:[], addOns:[], isFleece, colorCount,
//     locationCount, blankVendor }
import React from "react";

export default function ProofDocView({
  spec,
  mockupUrl,
  clientName = "",
  itemName = "",
  font = "Inter, system-ui, sans-serif",
  mono = "ui-monospace, 'SF Mono', Menlo, monospace",
}) {
  const s = spec || {};
  const locations = Array.isArray(s.locations) ? s.locations : [];
  const methods = Array.isArray(s.methods) ? s.methods : [];
  const notes = s.notes || "";
  // Prefer baked fields (self-contained spec); fall back for older specs saved
  // before those were baked — counts derive from locations, finishing from
  // instructions. Keeps legacy proofs rendering correctly.
  const nonTag = locations.filter(l => { const pl = String(l.placement || "").toLowerCase().trim(); return pl !== "tag" && pl !== "tags"; });
  const finishing = Array.isArray(s.finishing) ? s.finishing : (Array.isArray(s.instructions) ? s.instructions : []);
  const addOns = Array.isArray(s.addOns) ? s.addOns : [];
  const isFleece = !!s.isFleece;
  const colorCount = s.colorCount != null ? Number(s.colorCount) : nonTag.reduce((a, l) => a + ((l.colors || []).length), 0);
  const locationCount = s.locationCount != null ? Number(s.locationCount) : nonTag.length;
  const blankVendor = s.blankVendor || "—";

  const row = (label, val) => (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 12.5, color: "#1a1a1a", marginTop: 2 }}>{val}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", fontFamily: font, color: "#1a1a1a" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #1a1a1a", paddingBottom: 10 }}>
        <div style={{ fontSize: 21, fontWeight: 800 }}>{clientName || "—"}</div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 19, fontWeight: 900, letterSpacing: "-0.02em" }}>PRODUCT PROOF</div></div>
      </div>

      {/* Meta cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, padding: "14px 0" }}>
        {[["Item", itemName || "—"], ["Blank", blankVendor]].map(([k, v]) => (
          <div key={k} style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "12px 14px", minWidth: 0 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 4, lineHeight: 1.25, overflowWrap: "break-word" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Mockup */}
      {mockupUrl && <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 12px" }}><img src={mockupUrl} alt="" style={{ maxWidth: "100%", maxHeight: 190, objectFit: "contain" }} /></div>}

      {/* Special instructions notice */}
      {notes && (
        <div style={{ borderLeft: "4px solid #1a1a1a", background: "#f4f4f5", borderRadius: "0 8px 8px 0", padding: "13px 16px", marginTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Special Instructions</div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "#1a1a1a", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{notes}</div>
        </div>
      )}

      {/* Locations */}
      <div style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: mockupUrl ? 0 : 14 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Locations</div>
        {locations.length === 0 ? <div style={{ fontSize: 12, color: "#a0a0ad" }}>No print locations yet.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {locations.map((p, i) => (
              <div key={i} style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, paddingBottom: 8, marginBottom: 10, borderBottom: "1px solid #eee" }}>{p.placement || "—"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {row("Print size", <span style={{ fontFamily: mono }}>{p.sizeText || "—"}</span>)}
                  <div>
                    <div style={{ fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em" }}>Colors</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", marginTop: 4 }}>
                      {(p.colors || []).length > 0
                        ? (p.colors || []).map((c, j) => <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: c.hex || "#9aa0ae", border: "1px solid #e0e0e4", flexShrink: 0 }} />{c.name || "—"}</span>)
                        : <span style={{ fontSize: 12, color: "#a0a0ad" }}>—</span>}
                    </div>
                  </div>
                  {p.callout && row("Placement", p.callout)}
                  {(p.specialties || []).length > 0 && row("Add-ons", (p.specialties || []).join(", "))}
                </div>
              </div>
            ))}
          </div>
        )}
        {addOns.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Add-ons</div>
            <ul style={{ margin: 0, padding: "0 0 0 16px", listStyle: "disc" }}>
              {addOns.map((s2, i) => <li key={i} style={{ fontSize: 13.5, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.35, marginBottom: 3 }}>{s2}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Product spec KPIs */}
      <div style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: 18 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Product spec</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            ["Method", methods[0] || "—"],
            ["Colors", String(colorCount)],
            ["Locations", String(locationCount)],
            ...(isFleece ? [["Fleece", "Yes"]] : []),
          ].map(([k, v]) => (
            <div key={k} style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Finishing & handling */}
      {finishing.length > 0 && (
        <div style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: 18 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Finishing &amp; handling</div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc", columns: finishing.length > 3 ? 2 : 1, columnGap: 28 }}>
            {finishing.map((it, i) => <li key={i} style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.4, marginBottom: 6, breakInside: "avoid" }}>{it}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
