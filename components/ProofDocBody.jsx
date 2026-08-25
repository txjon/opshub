// PURE presentational body of the product proof — NO "use client", NO hooks, so
// it renders identically in the browser (via ProofDocView) AND server-side via
// renderToStaticMarkup → Browserless (the PDF). This is THE single source of the
// proof document layout: change it here and both web + PDF update. The only
// interactive/measured piece — the mockup crop widget — is injected as
// `mockupSlot` (interactive MockupFrame on web; a static <img> in the PDF).
import React from "react";

const LBL = { fontSize: 8.5, fontWeight: 700, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.05em" };
const SEC = { fontSize: 9, fontWeight: 800, color: "#a0a0ad", textTransform: "uppercase", letterSpacing: "0.06em" };
const isTag = (pl) => { const t = String(pl || "").toLowerCase().trim(); return t === "tag" || t === "tags"; };

// Inline text field that looks like the doc text until you focus it. Read-only
// (no onChange) → plain span identical to the old render.
function Ed({ value, onChange, placeholder, style, multiline, fill }) {
  if (!onChange) return <span style={style}>{value || placeholder || ""}</span>;
  const chars = String(value || placeholder || "").length;
  const autoW = `${Math.min(Math.max(chars + 1, 4), 46)}ch`;
  const shared = {
    value: value || "",
    onChange: (e) => onChange(e.target.value),
    placeholder,
    style: {
      ...style, fontFamily: "inherit", color: "inherit",
      border: "none", borderBottom: "1.5px dotted #b9b9c2", background: "transparent",
      outline: "none", padding: "0 1px", borderRadius: 0,
      ...(multiline || fill ? { width: "100%", boxSizing: "border-box" } : { width: autoW, maxWidth: "100%" }),
      ...(multiline ? { resize: "vertical", minHeight: 44, lineHeight: 1.45 } : {}),
    },
  };
  return multiline ? <textarea rows={2} {...shared} /> : <input {...shared} />;
}

// A dashed "+ add" affordance (edit-only).
function AddBtn({ onClick, children, block, disabled, title, accent }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: block ? "grid" : "inline-flex", placeItems: "center", alignItems: "center",
      fontSize: 11, fontWeight: 700, color: accent ? "#b45309" : "#6b6b78", background: "#fff",
      border: `1px dashed ${accent ? "#f59e0b" : "#dcdce0"}`, borderRadius: 6, padding: "3px 10px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>{children}</button>
  );
}

export default function ProofDocBody({
  spec,
  mockupSlot = null,
  clientName = "",
  itemName = "",
  brandName = "",
  logoSvg = "",
  edit = null,
  font = "Inter, system-ui, sans-serif",
  mono = "ui-monospace, 'SF Mono', Menlo, monospace",
}) {
  const s = spec || {};
  const E = edit || null;
  const locations = Array.isArray(s.locations) ? s.locations : [];
  const methods = Array.isArray(s.methods) ? s.methods : [];
  const notes = s.notes || "";
  const nonTag = locations.filter(l => !isTag(l.placement));
  const finishing = Array.isArray(s.finishing) ? s.finishing : (Array.isArray(s.instructions) ? s.instructions : []);
  const addOns = Array.isArray(s.addOns) ? s.addOns : [];
  const isFleece = !!s.isFleece;
  const autoColors = nonTag.reduce((a, l) => a + ((l.colors || []).length), 0);
  const ccNum = Number(s.colorCount);
  const lcNum = Number(s.locationCount);
  const colorCount = (s.colorCount != null && s.colorCount !== "" && Number.isFinite(ccNum)) ? ccNum : autoColors;
  const locationCount = (s.locationCount != null && s.locationCount !== "" && Number.isFinite(lcNum)) ? lcNum : locations.length;
  const blankVendor = s.blankVendor || "—";
  const blankColor = s.blankColor || "";
  const summaryText = s.summaryText || "";
  const disclaimer = s.disclaimer || "";
  const printType = s.printType || "";
  const hasMockup = !!mockupSlot;

  const rowLabel = (label, val) => (
    <div>
      <div style={LBL}>{label}</div>
      <div style={{ fontSize: 12.5, color: "#1a1a1a", marginTop: 2 }}>{val}</div>
    </div>
  );

  // NOTE: the "proof-*" classNames are styling hooks for the PDF ONLY — the
  // print stylesheet in lib/proof-html.ts tightens spacing/sizes and sets page
  // break rules through them. Nothing in the app targets these classes, so the
  // web render is untouched. Keep them when editing this layout.
  return (
    <div className="proof-doc" style={{ maxWidth: 760, margin: "0 auto", fontFamily: font, color: "#1a1a1a" }}>
      {/* Header */}
      <div className="proof-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #1a1a1a", paddingBottom: 10 }}>
        {logoSvg
          ? <span style={{ display: "inline-block", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: logoSvg }} />
          : <div style={{ fontSize: 21, fontWeight: 800 }}>{brandName || clientName || "—"}</div>}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 19, fontWeight: 900, letterSpacing: "-0.02em" }}>PRODUCT PROOF</div>
          {clientName && <div style={{ fontSize: 11, fontWeight: 600, color: "#6b6b78", marginTop: 2 }}>Prepared for {clientName}</div>}
        </div>
      </div>

      {/* Item title + blank — document style (no boxes, no labels) */}
      <div className="proof-titleblock" style={{ padding: "18px 0 4px" }}>
        <div className="proof-title" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.015em", lineHeight: 1.12, overflowWrap: "break-word" }}>{itemName || "—"}</div>
        {(() => {
          const sub = [blankVendor === "—" ? "" : blankVendor, blankColor].filter(Boolean).join(" · ");
          return sub ? <div className="proof-sub" style={{ fontSize: 14, color: "#6b6b78", marginTop: 6 }}>{sub}</div> : null;
        })()}
      </div>

      {/* Mockup (injected — interactive on web, static image in PDF) */}
      {mockupSlot}

      {/* Special instructions notice — shows in edit even when empty (so it's addable) */}
      {(notes || E?.setNotes) && (
        <div className="proof-notes" style={{ borderLeft: "4px solid #1a1a1a", background: "#f4f4f5", borderRadius: "0 8px 8px 0", padding: "13px 16px", marginTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Special Instructions</div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "#1a1a1a", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
            <Ed value={notes} onChange={E?.setNotes} placeholder="Add special instructions…" multiline style={{ fontSize: 14.5, fontWeight: 600 }} />
          </div>
        </div>
      )}

      {/* Locations */}
      <div className="proof-section proof-locations" style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: hasMockup ? 0 : 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={SEC}>Locations</div>
          {E && (
            <div style={{ display: "flex", gap: 6 }}>
              {E.pullFromPsd && (
                <AddBtn onClick={E.pullFromPsd} disabled={E.pullingPsd} accent={E.psdNewer}
                  title={E.psdNewer ? "A newer PSD was uploaded since this proof was seeded" : "Replace location names, sizes and colors from this item's print-ready PSD. Callouts, method, instructions and notes are kept."}>
                  {E.pullingPsd ? "Pulling…" : (E.psdNewer ? "↻ pull from PSD · newer file" : "↻ pull from PSD")}
                </AddBtn>
              )}
              {E.addLocation && <AddBtn onClick={E.addLocation}>+ location</AddBtn>}
              {E.addTag && <AddBtn onClick={E.addTag}>+ tag</AddBtn>}
            </div>
          )}
        </div>
        {locations.length === 0 && !E ? <div style={{ fontSize: 12, color: "#a0a0ad" }}>No print locations yet.</div> : (
          <div className="proof-loc-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {locations.map((p, i) => {
              const tag = isTag(p.placement);
              return (
                <div key={i} className="proof-loc-card" style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "12px 14px", position: "relative", breakInside: "avoid" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBottom: 8, marginBottom: 10, borderBottom: "1px solid #eee" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                      <Ed value={p.placement} onChange={E?.updateLocation ? (v) => E.updateLocation(i, { placement: v }) : null} placeholder="Placement" style={{ fontSize: 13.5, fontWeight: 800 }} widthCh={E ? 12 : undefined} />
                    </div>
                    {E?.removeLocation && <button onClick={() => E.removeLocation(i)} title="Remove location" style={{ background: "none", border: "none", color: "#c3c3cc", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {rowLabel("Print size", <Ed value={p.sizeText} onChange={E?.updateLocation ? (v) => E.updateLocation(i, { sizeText: v }) : null} placeholder='W" × H"' style={{ fontFamily: mono, fontSize: 12.5 }} widthCh={E ? 10 : undefined} />)}
                    <div>
                      <div style={LBL}>Colors</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", marginTop: 4 }}>
                        {(p.colors || []).length > 0
                          ? (p.colors || []).map((c, j) => (
                            <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
                              {E?.updateColor ? (
                                <label style={{ width: 13, height: 13, borderRadius: 3, background: c.hex || "#9aa0ae", border: "1px solid #e0e0e4", flexShrink: 0, cursor: "pointer", position: "relative", overflow: "hidden", display: "inline-block" }}>
                                  <input type="color" value={c.hex || "#9aa0ae"} onChange={(e) => E.updateColor(i, j, { hex: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
                                </label>
                              ) : (
                                <span style={{ width: 11, height: 11, borderRadius: 3, background: c.hex || "#9aa0ae", border: "1px solid #e0e0e4", flexShrink: 0 }} />
                              )}
                              <Ed value={c.name} onChange={E?.updateColor ? (v) => E.updateColor(i, j, { name: v, ...(!c.hex && E.resolveHex && E.resolveHex(v) ? { hex: E.resolveHex(v) } : {}) }) : null} placeholder="Color" style={{ fontSize: 11.5 }} widthCh={E ? Math.min(Math.max((c.name || "").length + 1, 5), 16) : undefined} />
                              {E?.removeColor && <button onClick={() => E.removeColor(i, j)} title="Remove" style={{ background: "none", border: "none", color: "#c3c3cc", cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1 }}>×</button>}
                            </span>
                          ))
                          : (!E && <span style={{ fontSize: 12, color: "#a0a0ad" }}>—</span>)}
                        {E?.addColor && <button onClick={() => E.addColor(i)} style={{ fontSize: 10, fontWeight: 700, color: "#6b6b78", background: "#fff", border: "1px dashed #dcdce0", borderRadius: 5, padding: "1px 7px", cursor: "pointer", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>+ color</button>}
                      </div>
                      {/* Tag "set all ink" (edit-only) */}
                      {E?.setAllInk && tag && (p.colors || []).length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                          <span style={{ ...LBL, fontSize: 8 }}>Set all ink</span>
                          {[["Black", "#000000"], ["Grey", "#7a7a82"], ["White", "#ffffff"]].map(([lb, hx]) => (
                            <button key={lb} onClick={() => E.setAllInk(i, hx)} title={`All chips → ${lb}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#6b6b78", background: "#fff", border: "1px solid #dcdce0", borderRadius: 5, padding: "1px 6px", cursor: "pointer", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: hx, border: "1px solid #dcdce0" }} />{lb}
                            </button>
                          ))}
                          <label style={{ fontSize: 10, fontWeight: 600, color: "#6b6b78", background: "#fff", border: "1px solid #dcdce0", borderRadius: 5, padding: "1px 6px", cursor: "pointer", position: "relative", overflow: "hidden", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
                            Custom<input type="color" onChange={(e) => E.setAllInk(i, e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
                          </label>
                        </div>
                      )}
                    </div>
                    {(p.callout || E?.updateLocation) && rowLabel("Placement", <Ed value={p.callout} onChange={E?.updateLocation ? (v) => E.updateLocation(i, { callout: v }) : null} placeholder="Placement callout…" style={{ fontSize: 12.5 }} multiline />)}
                    {E?.toggleSpecialty && (E.addOnOptions || []).length > 0 ? (
                      <div>
                        <div style={LBL}>Add-ons</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                          {E.addOnOptions.map(sp => {
                            const on = (p.specialties || []).includes(sp);
                            return <button key={sp} onClick={() => E.toggleSpecialty(i, sp)} title={on ? `${sp} on this print — click to remove` : `Add ${sp} to this print`}
                              style={{ fontSize: 11, fontWeight: on ? 700 : 500, color: on ? "#fff" : "#6b6b78", background: on ? "#1a1a1a" : "#fff", border: `1px solid ${on ? "#1a1a1a" : "#dcdce0"}`, borderRadius: 6, padding: "2px 9px", cursor: "pointer", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>{sp}</button>;
                          })}
                        </div>
                      </div>
                    ) : ((p.specialties || []).length > 0 && rowLabel("Add-ons", (p.specialties || []).join(", ")))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Product spec KPIs */}
      <div className="proof-section" style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: 18 }}>
        <div style={{ ...SEC, marginBottom: 10 }}>Product spec</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            ["Method", methods[0] || "—", E?.setMethod, E?.methodOptions],
            ["Type", printType || "—", E?.setType, E?.typeOptions],
            ["Locations", String(locationCount), null, null],
            ...(isFleece ? [["Fleece", "Yes", null, null]] : []),
          ].map(([k, v, onChange, opts]) => {
            const dlId = `pv-opts-${k.toLowerCase()}`;
            return (
              <div key={k} className="proof-kpi" style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ ...LBL, fontSize: 8.5 }}>{k}</div>
                <div className="proof-kpi-val" style={{ fontSize: 17, fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>
                  {onChange ? (
                    <>
                      <input list={opts ? dlId : undefined} value={v === "—" ? "" : v} onChange={(e) => onChange(e.target.value)} placeholder={k}
                        style={{ fontSize: 17, fontWeight: 800, fontFamily: "inherit", color: "inherit", border: "none", borderBottom: "1.5px dotted #b9b9c2", background: "transparent", outline: "none", width: "100%", padding: 0, boxSizing: "border-box" }} />
                      {opts && <datalist id={dlId}>{opts.map(o => <option key={o} value={o} />)}</datalist>}
                    </>
                  ) : v}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Finishing & handling — KPI-style chip cards */}
      {(finishing.length > 0 || E?.addFinishing) && (
        <div className="proof-section" style={{ borderTop: "2px solid #1a1a1a", paddingTop: 12, marginTop: 18 }}>
          <div style={{ ...SEC, marginBottom: 10 }}>Finishing &amp; handling</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {finishing.map((it, i) => (
              <div key={i} className="proof-chip" style={{ border: "1px solid #e0e0e4", borderRadius: 10, padding: "10px 14px", minWidth: 130, position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
                <div className="proof-chip-val" style={{ fontSize: 14, fontWeight: 800 }}>{it}</div>
                {E?.removeFinishing && i >= (E.costingFinishingCount || 0) && <button onClick={() => E.removeFinishing(i)} title="Remove" style={{ background: "none", border: "none", color: "#c3c3cc", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>}
              </div>
            ))}
            {E?.addFinishing && (
              <div style={{ position: "relative" }}>
                <input list="pv-finishing" placeholder="+ finishing"
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { E.addFinishing(e.target.value.trim()); e.target.value = ""; } }}
                  onChange={(e) => { const v = e.target.value; if (v && (E.finishingOptions || []).includes(v)) { E.addFinishing(v); e.target.value = ""; } }}
                  style={{ fontSize: 12, fontWeight: 700, color: "#6b6b78", background: "#fff", border: "1px dashed #dcdce0", borderRadius: 10, padding: "10px 14px", minWidth: 130, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", outline: "none" }} />
                {E.finishingOptions && <datalist id="pv-finishing">{E.finishingOptions.map(o => <option key={o} value={o} />)}</datalist>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legacy item-level add-ons (kept for older specs) */}
      {addOns.length > 0 && (
        <div className="proof-section" style={{ borderTop: "1px solid #e0e0e4", paddingTop: 12, marginTop: 18 }}>
          <div style={{ ...SEC, marginBottom: 6 }}>Add-ons</div>
          <ul style={{ margin: 0, padding: "0 0 0 16px", listStyle: "disc" }}>
            {addOns.map((s2, i) => <li key={i} style={{ fontSize: 13.5, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.35, marginBottom: 3 }}>{s2}</li>)}
          </ul>
        </div>
      )}

      {/* Approval disclaimer */}
      {(disclaimer || E?.setDisclaimer) && (
        <div className="proof-section proof-approval" style={{ borderTop: "1px solid #e0e0e4", paddingTop: 12, marginTop: 18 }}>
          <div style={{ ...SEC, marginBottom: 6 }}>Approval</div>
          <div className="proof-approval-text" style={{ fontSize: 11, color: "#6b6b78", lineHeight: 1.5 }}>
            <Ed value={disclaimer} onChange={E?.setDisclaimer} placeholder="Approval disclaimer…" multiline fill style={{ fontSize: 11, color: "#6b6b78" }} />
          </div>
        </div>
      )}
    </div>
  );
}
