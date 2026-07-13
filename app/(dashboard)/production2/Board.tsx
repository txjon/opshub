"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { T, font, mono, sortSizes } from "@/lib/theme";
import type { BoardStrip, BoardItem } from "@/lib/item-state";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

const ROUTE_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  drop_ship: { label: "Drop-ship", bg: T.purpleDim, fg: T.purple },
  ship_through: { label: "Ship-through", bg: T.blueDim, fg: T.blue },
  stage: { label: "Stage", bg: T.amberDim, fg: "#8a6400" },
};

export default function Board({ strips }: { strips: BoardStrip[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [shipOpen, setShipOpen] = useState(false);

  const allItems = useMemo(() => {
    const m = new Map<string, BoardItem & { strip: BoardStrip }>();
    for (const s of strips) for (const it of s.items) m.set(it.itemId, { ...it, strip: s });
    return m;
  }, [strips]);

  // A shipment is ONE vendor. The active selection locks to the first picked
  // item's vendor; items of any other vendor can't be added to it.
  const selVendor = useMemo(() => {
    for (const id of Array.from(sel)) { const it = allItems.get(id); if (it) return it.decoratorId; }
    return null;
  }, [sel, allItems]);

  const toggle = (it: BoardItem) => {
    setSel(prev => {
      const next = new Set(prev);
      if (next.has(it.itemId)) next.delete(it.itemId);
      else next.add(it.itemId);
      return next;
    });
  };

  const selectedItems = useMemo(
    () => Array.from(sel).map(id => allItems.get(id)!).filter(Boolean),
    [sel, allItems]);
  const selUnits = selectedItems.reduce((a, it) => a + it.owedTotal, 0);
  const selVendorName = selectedItems[0]?.decoratorName ?? "";

  const totalItems = strips.reduce((a, s) => a + s.items.length, 0);

  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 96 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Production</h1>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.blue, background: T.blueDim, padding: "2px 8px", borderRadius: 999 }}>v2 · parallel</span>
        </div>
        <p style={{ color: T.muted, fontSize: 13, margin: "0 0 22px" }}>
          Ship items out from production. {totalItems} items across {strips.length} job × vendor strips.
        </p>

        {strips.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            Nothing in production to ship.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {strips.map(strip => {
            const badge = ROUTE_BADGE[strip.jobRoute] || ROUTE_BADGE.ship_through;
            const stripUnits = strip.items.reduce((a, i) => a + i.owedTotal, 0);
            return (
              <div key={strip.key} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {/* strip header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                  <Link href={`/jobs/${strip.jobId}`} style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: T.text, textDecoration: "none" }}>
                    {strip.jobNumber}
                  </Link>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{strip.jobTitle}</span>
                  <span style={{ fontSize: 12, color: T.muted }}>{strip.clientName}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: badge.fg, background: badge.bg, padding: "2px 8px", borderRadius: 999 }}>{badge.label}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{strip.decoratorName}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{stripUnits} owed</span>
                </div>

                {/* items */}
                <div>
                  {strip.items.map(it => {
                    const checked = sel.has(it.itemId);
                    const blocked = selVendor !== null && it.decoratorId !== selVendor && !checked;
                    const sizes = sortSizes(Object.keys(it.owed).length ? Object.keys(it.owed) : Object.keys(it.ordered));
                    return (
                      <label key={it.itemId}
                        style={{
                          display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                          borderTop: `1px solid ${T.border}`, cursor: blocked ? "not-allowed" : "pointer",
                          opacity: blocked ? 0.4 : 1, background: checked ? T.blueDim : "transparent",
                        }}>
                        <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(it)}
                          style={{ width: 16, height: 16, accentColor: T.blue, cursor: blocked ? "not-allowed" : "pointer" }} />
                        {it.mockupColor
                          ? <span title={it.mockupColor} style={{ width: 18, height: 18, borderRadius: 5, background: it.mockupColor, border: `1px solid ${T.border}`, flexShrink: 0 }} />
                          : <span style={{ width: 18, height: 18, borderRadius: 5, background: T.accentDim, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13, fontWeight: 500, minWidth: 180 }}>{it.name}</span>

                        {/* per-variant owed grid */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                          {sizes.map(sz => (
                            <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 34, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, letterSpacing: 0.3 }}>{sz}</span>
                              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{it.owed[sz] ?? it.ordered[sz] ?? 0}</span>
                            </span>
                          ))}
                        </div>

                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, minWidth: 44, textAlign: "right" }}>{it.owedTotal}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: T.amber, background: T.amberDim, padding: "2px 7px", borderRadius: 999, textTransform: "uppercase", letterSpacing: 0.3 }}>
                          {it.status === "partially_shipped" ? "wave" : "in prod"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* sticky ship bar */}
      {sel.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.card, borderTop: `1px solid ${T.border}`, boxShadow: "0 -4px 20px rgba(0,0,0,0.06)", padding: "14px 24px", zIndex: 40 }}>
          <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{sel.size} item{sel.size > 1 ? "s" : ""} selected</span>
            <span style={{ fontSize: 12, color: T.muted }}>{selVendorName} · {selUnits} units</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSel(new Set())} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", color: T.muted }}>Clear</button>
            <button onClick={() => setShipOpen(true)} style={{ fontSize: 13, fontWeight: 600, background: T.text, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer" }}>Ship {sel.size} selected →</button>
          </div>
        </div>
      )}

      {shipOpen && <ShipModal items={selectedItems} vendorName={selVendorName} onClose={() => setShipOpen(false)} />}
    </div>
  );
}

// Ship modal — PREVIEW. Layout + per-item qty/final controls are real so the flow
// can be reviewed; the confirm (write) is wired in the next slice.
function ShipModal({ items, vendorName, onClose }: { items: BoardItem[]; vendorName: string; onClose: () => void }) {
  const [method, setMethod] = useState<"tracking" | "bol" | "pickup">("tracking");
  const totalUnits = items.reduce((a, it) => a + it.owedTotal, 0);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, maxWidth: 640, width: "100%", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Ship from production</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{vendorName} · {items.length} items · {totalUnits} units → one shipment</div>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* method segment */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>How it's leaving</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["tracking", "bol", "pickup"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: "8px 0", borderRadius: 8, cursor: "pointer", border: `1px solid ${method === m ? T.text : T.border}`, background: method === m ? T.text : T.card, color: method === m ? "#fff" : T.muted }}>
                  {m === "tracking" ? "Tracking #" : m === "bol" ? "Freight BOL" : "Pickup"}
                </button>
              ))}
            </div>
            <input placeholder={method === "tracking" ? "Tracking number" : method === "bol" ? "BOL number" : "Pickup date"} style={{ marginTop: 8, width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: method === "pickup" ? font : mono }} />
          </div>

          {/* per-item qty + final */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map(it => (
              <div key={it.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
                  <div style={{ flex: 1 }} />
                  <label style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input type="checkbox" style={{ accentColor: T.blue }} /> final shipment
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sortSizes(Object.keys(it.owed).length ? Object.keys(it.owed) : Object.keys(it.ordered)).map(sz => (
                    <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 40, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.faint }}>{sz}</span>
                      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{it.owed[sz] ?? it.ordered[sz] ?? 0}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: T.amber, background: T.amberDim, padding: "4px 9px", borderRadius: 6, fontWeight: 600 }}>Preview — confirm/write is the next slice</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
          <button disabled style={{ fontSize: 13, fontWeight: 600, background: T.accentDim, color: T.faint, border: "none", borderRadius: 8, padding: "9px 20px", cursor: "not-allowed" }}>Confirm ship</button>
        </div>
      </div>
    </div>
  );
}
