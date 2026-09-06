"use client";
// EditSizesModal — extracted from ProductBuilder.jsx at the classic job-page
// decommission (Sep 5 2026). Used by JobDetailV2's Build tab; add/remove sizes
// + set qtys on an item without re-running the blank picker.
import React, { useState, useEffect } from "react";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { distribute, DEFAULT_CURVE, WAIST_INSEAM_CURVE } from "./BuySheetTab";

// ═══════════════════════════════════════════════════════════════
// EditSizesModal — add/remove sizes + set qtys on an item without
// going back through the blank picker. Toggle row picks which sizes
// are active; qty grid for active sizes; Distribute helper fills by
// the item's curve (or default S/M/L/XL ladder).
// ═══════════════════════════════════════════════════════════════
export function EditSizesModal({ item, onClose, onSave, zIndex = 110 }) {
  // Working copy of sizes + qtys — committed via onSave on save.
  const [sizes, setSizes] = useState(() => [...(item.sizes || [])]);
  const [qtys, setQtys] = useState(() => ({ ...(item.qtys || {}) }));
  const [distTotal, setDistTotal] = useState("");

  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Adult + youth sizes from the canonical SIZE_ORDER. OS / OSFA are
  // one-size variants — clicked individually they swap the item to
  // single-size mode (any other adult/youth size toggling them off).
  const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const YOUTH_SIZES = ["YXS", "YS", "YM", "YL", "YXL"];
  const ONE_SIZE = ["OSFA", "OS"];

  const toggleSize = (sz) => {
    const isOneSize = ONE_SIZE.includes(sz);
    const next = new Set(sizes);
    if (next.has(sz)) {
      next.delete(sz);
      const q = { ...qtys }; delete q[sz];
      setQtys(q);
    } else {
      // Toggling a one-size variant clears the sized list and vice
      // versa — an item is either "OSFA · qty" or a size run.
      if (isOneSize) {
        setQtys({ [sz]: qtys[sz] || 0 });
        setSizes([sz]);
        return;
      } else {
        for (const o of ONE_SIZE) next.delete(o);
      }
      next.add(sz);
    }
    setSizes(sortSizesLocal([...next]));
  };

  const setQty = (sz, val) => {
    const n = parseInt(val, 10);
    setQtys({ ...qtys, [sz]: Number.isFinite(n) && n >= 0 ? n : 0 });
  };

  const doDist = () => {
    const total = parseInt(distTotal, 10);
    if (!Number.isFinite(total) || total <= 0 || sizes.length === 0) return;
    // Dimensional (waist × inseam) sizes distribute on the real WxL sell-through
    // curve; letter sizes use the item's curve / the default tee curve.
    const curve = parseSizeMatrix(sizes, null) ? WAIST_INSEAM_CURVE : (item.curve || DEFAULT_CURVE);
    const next = distribute(total, sizes, curve);
    setQtys(next);
    setDistTotal("");
  };

  const total = Object.values(qtys).reduce((a, v) => a + (Number(v) || 0), 0);

  // Waist × Inseam (cut-and-sew pants) — pre-loaded with the Ridgeline ranges.
  // Selecting cells produces "{waist} / {inseam} ({name})" labels, the same
  // dimensional format the size grid pivots into a cut-ticket (waist rows ×
  // inseam cols) on the card + PDFs.
  const WI_WAISTS = [28, 30, 32, 34, 36, 38, 40, 42];
  const WI_INSEAMS = [{ num: 30, name: "Short" }, { num: 32, name: "Regular" }, { num: 34, name: "Long" }, { num: 36, name: "Tall" }];
  const wiLabel = (w, i) => `${w} / ${i.num} (${i.name})`;
  const [showWI, setShowWI] = useState(() => !!parseSizeMatrix(item.sizes || [], null));
  const setMany = (labels, on) => {
    const next = new Set(sizes);
    if (on) { for (const o of ONE_SIZE) next.delete(o); labels.forEach(l => next.add(l)); }
    else { labels.forEach(l => next.delete(l)); }
    setSizes(sortSizesLocal([...next]));
    if (!on) { const q = { ...qtys }; labels.forEach(l => delete q[l]); setQtys(q); }
  };
  const toggleWaistRow = (w) => { const ls = WI_INSEAMS.map(i => wiLabel(w, i)); setMany(ls, !ls.every(l => sizes.includes(l))); };
  const toggleInseamCol = (i) => { const ls = WI_WAISTS.map(w => wiLabel(w, i)); setMany(ls, !ls.every(l => sizes.includes(l))); };

  return (
    <div onClick={onClose}
      style={{  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: zIndex, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)", fontFamily: font }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, borderRadius: 12, width: "min(900px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${T.border}` }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit sizes & qtys</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "Item"}</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* SIZES — centered across the top */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, textAlign: "center" }}>Sizes</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, justifyContent: "center" }}>
              {ADULT_SIZES.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 42, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#0a0a0a" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                    {sz}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, justifyContent: "center" }}>
              {YOUTH_SIZES.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 42, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#0a0a0a" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                    {sz}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {ONE_SIZE.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 64, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#0a0a0a" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}
                    title="One-size — replaces any sized run">
                    {sz}
                  </button>
                );
              })}
            </div>
          </div>

          {/* WAIST × INSEAM + QUANTITIES — side by side */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
          {/* Waist × Inseam (pants) — pre-loaded Ridgeline ranges; click cells to select. */}
          <div>
            <button onClick={() => setShowWI(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Waist × Inseam (pants) <span style={{ fontSize: 9 }}>{showWI ? "▾" : "▸"}</span>
            </button>
            {showWI && (
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 4, fontSize: 9, color: T.faint, fontWeight: 700 }}>W \ I</th>
                      {WI_INSEAMS.map(i => (
                        <th key={i.num} onClick={() => toggleInseamCol(i)} title="Toggle whole column"
                          style={{ padding: "4px 6px", fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.muted, cursor: "pointer", textAlign: "center" }}>
                          {i.num}<div style={{ fontSize: 8, fontWeight: 600, color: T.faint }}>{i.name}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WI_WAISTS.map(w => (
                      <tr key={w}>
                        <td onClick={() => toggleWaistRow(w)} title="Toggle whole row"
                          style={{ padding: "4px 8px", fontSize: 12, fontFamily: mono, fontWeight: 700, color: T.muted, cursor: "pointer", textAlign: "center" }}>{w}</td>
                        {WI_INSEAMS.map(i => {
                          const label = wiLabel(w, i); const on = sizes.includes(label);
                          return (
                            <td key={i.num} style={{ padding: 2 }}>
                              <button onClick={() => toggleSize(label)}
                                style={{ width: 38, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, background: on ? T.accent : T.card, color: on ? "#0a0a0a" : T.faint, border: `1px solid ${on ? T.accent : T.border}` }}>
                                {on ? "✓" : ""}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 8, maxWidth: 230, lineHeight: 1.4 }}>Click a cell to include that size. Click a W or I header to toggle a whole row / column.</div>
              </div>
            )}
          </div>

          {/* RIGHT — quantities + distribute */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Qty grid for active sizes */}
          {sizes.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Quantities</div>
              {parseSizeMatrix(sizes, null) ? (
                // Dimensional (waist × inseam) → pivoted cut-ticket grid w/ totals.
                <SizeGridInput
                  sizes={sizes}
                  getValue={sz => qtys[sz] ?? 0}
                  onChange={(sz, v) => setQty(sz, v)}
                  onCommit={() => {}}
                  disabled={false}
                  ic={{ border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontFamily: font, outline: "none" }}
                />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {sizes.map(sz => (
                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, fontFamily: mono }}>{sz}</span>
                      <input type="text" inputMode="numeric" value={qtys[sz] ?? 0}
                        onChange={e => setQty(sz, e.target.value)}
                        onFocus={e => e.target.select()}
                        style={{ width: 56, height: 36, textAlign: "center", fontSize: 14, fontWeight: 600,
                          border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text,
                          fontFamily: font, outline: "none" }} />
                    </div>
                  ))}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, marginLeft: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: T.faint }}>TOTAL</span>
                    <span style={{ fontSize: 20, fontWeight: 800, fontFamily: mono, color: T.text }}>{total}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          </div>{/* /RIGHT — qty only */}
          </div>{/* /side-by-side row */}

          {/* Distribute helper — full width below the grids */}
          {sizes.length > 0 && !ONE_SIZE.includes(sizes[0]) && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Distribute total</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input type="text" inputMode="numeric" value={distTotal}
                  onChange={e => setDistTotal(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doDist()}
                  placeholder="Total qty"
                  style={{ width: 110, height: 36, padding: "0 10px", fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontFamily: font, outline: "none" }} />
                <button onClick={doDist}
                  style={{ fontSize: 12, color: "#0a0a0a", background: T.accent, border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontFamily: font }}>
                  Fill
                </button>
                <span style={{ fontSize: 11, color: T.faint }}>Spreads total across active sizes using the item's curve.</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 18px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            Cancel
          </button>
          <button onClick={() => onSave(sizes, qtys)}
            style={{ padding: "8px 22px", background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
