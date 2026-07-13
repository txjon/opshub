"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { T, font, mono, sortSizes } from "@/lib/theme";
import type { BoardStrip, BoardItem } from "@/lib/item-state";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

const ROUTE_LABEL: Record<string, { label: string; fg: string }> = {
  drop_ship: { label: "Drop-ship", fg: T.purple },
  ship_through: { label: "Ship-through", fg: T.blue },
  stage: { label: "Stage", fg: "#a87b00" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtShip(iso: string | null): { text: string; days: number | null } {
  if (!iso) return { text: "No ship date", days: null };
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = new Date(y, (m || 1) - 1, d || 1);
  const days = Math.round((t1.getTime() - t0.getTime()) / 86400000);
  return { text: `${MONTHS[(m || 1) - 1]} ${d}`, days };
}

type SortKey = "ship" | "client" | "vendor";
type MetricKey = "items" | "units" | "embellishments";
type Metric = { items: number; units: number; embellishments: number };
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "items", label: "Items" }, { key: "units", label: "Units" }, { key: "embellishments", label: "Embellishments" },
];
const nf = (n: number) => n.toLocaleString();

export default function Board({ strips }: { strips: BoardStrip[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [shipOpen, setShipOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("ship");
  const [kpi, setKpi] = useState<MetricKey | null>(null);

  // KPI aggregates over the whole board (independent of the search filter).
  const agg = useMemo(() => {
    const total: Metric = { items: 0, units: 0, embellishments: 0 };
    const byVendor = new Map<string, Metric>();
    const byClient = new Map<string, Metric>();
    const bump = (m: Map<string, Metric>, k: string, it: BoardItem) => {
      const cur = m.get(k) || { items: 0, units: 0, embellishments: 0 };
      cur.items += 1; cur.units += it.orderedTotal; cur.embellishments += it.embellishments;
      m.set(k, cur);
    };
    for (const s of strips) for (const it of s.items) {
      total.items += 1; total.units += it.orderedTotal; total.embellishments += it.embellishments;
      bump(byVendor, s.decoratorName, it); bump(byClient, s.clientName, it);
    }
    return { total, byVendor, byClient };
  }, [strips]);

  const allItems = useMemo(() => {
    const m = new Map<string, BoardItem & { strip: BoardStrip }>();
    for (const s of strips) for (const it of s.items) m.set(it.itemId, { ...it, strip: s });
    return m;
  }, [strips]);

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = strips;
    if (q) out = strips.filter(s =>
      s.clientName.toLowerCase().includes(q) ||
      (s.invoiceNumber || "").toLowerCase().includes(q) ||
      s.jobNumber.toLowerCase().includes(q) ||
      s.decoratorName.toLowerCase().includes(q) ||
      s.items.some(it => it.name.toLowerCase().includes(q)));
    const byShip = (a: BoardStrip, b: BoardStrip) =>
      (a.shipDate || "9999").localeCompare(b.shipDate || "9999") || a.jobNumber.localeCompare(b.jobNumber);
    const sorted = [...out];
    if (sort === "ship") sorted.sort(byShip);
    else if (sort === "client") sorted.sort((a, b) => a.clientName.localeCompare(b.clientName) || byShip(a, b));
    else sorted.sort((a, b) => a.decoratorName.localeCompare(b.decoratorName) || byShip(a, b));
    return sorted;
  }, [strips, query, sort]);

  // A shipment is ONE vendor. Selection locks to the first picked item's vendor.
  const selVendor = useMemo(() => {
    for (const id of Array.from(sel)) { const it = allItems.get(id); if (it) return it.decoratorId; }
    return null;
  }, [sel, allItems]);

  const toggle = (it: BoardItem) => setSel(prev => {
    const next = new Set(prev);
    next.has(it.itemId) ? next.delete(it.itemId) : next.add(it.itemId);
    return next;
  });

  const selectedItems = useMemo(() => Array.from(sel).map(id => allItems.get(id)!).filter(Boolean), [sel, allItems]);
  const selUnits = selectedItems.reduce((a, it) => a + it.owedTotal, 0);
  const selVendorName = selectedItems[0]?.decoratorName ?? "";
  const totalItems = strips.reduce((a, s) => a + s.items.length, 0);

  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 96 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Production</h1>
          <span style={{ fontSize: 12, color: T.faint }}>v2 · parallel dev</span>
        </div>
        <p style={{ color: T.muted, fontSize: 13, margin: "0 0 16px" }}>
          Ship items out from production. {totalItems} items across {strips.length} job × vendor strips.
        </p>

        {/* KPIs — click a tile for a by-vendor / by-client breakdown */}
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setKpi(m.key)}
              style={{ flex: 1, textAlign: "left", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
              <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, marginTop: 2 }}>{nf(agg.total[m.key])}</div>
              <div style={{ fontSize: 11, color: T.blue, marginTop: 2 }}>breakdown →</div>
            </button>
          ))}
        </div>

        {/* toolbar: one search + sort */}
        <div style={{ display: "flex", gap: 12, marginBottom: 18, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search client, invoice, vendor, or item…"
            style={{ flex: 1, minWidth: 240, fontSize: 13, padding: "10px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, outline: "none" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: T.faint }}>Sort</span>
            <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 9, overflow: "hidden" }}>
              {([["ship", "Ship date"], ["client", "Client"], ["vendor", "Vendor"]] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setSort(k)}
                  style={{ fontSize: 12, fontWeight: 600, padding: "9px 14px", border: "none", cursor: "pointer", background: sort === k ? T.text : T.card, color: sort === k ? "#fff" : T.muted }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No strips match your search." : "Nothing in production to ship."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {display.map(strip => {
            const route = ROUTE_LABEL[strip.jobRoute] || ROUTE_LABEL.ship_through;
            const stripUnits = strip.items.reduce((a, i) => a + i.owedTotal, 0);
            const ship = fmtShip(strip.shipDate);
            const shipColor = ship.days == null ? T.faint : ship.days < 0 ? T.red : ship.days <= 3 ? "#a87b00" : T.text;
            return (
              <div key={strip.key} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {/* strip header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{strip.clientName}</span>
                  {strip.invoiceNumber
                    ? <Link href={`/jobs/${strip.jobId}`} style={{ fontFamily: mono, fontSize: 12, color: T.blue, textDecoration: "none", fontWeight: 600 }}>#{strip.invoiceNumber}</Link>
                    : <Link href={`/jobs/${strip.jobId}`} style={{ fontFamily: mono, fontSize: 12, color: T.faint, textDecoration: "none" }}>no invoice</Link>}
                  <span style={{ fontSize: 10, fontWeight: 700, color: route.fg, textTransform: "uppercase", letterSpacing: 0.5 }}>{route.label}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{strip.decoratorName}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{stripUnits}u</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: shipColor, minWidth: 78, textAlign: "right" }}>
                    {ship.text}{ship.days != null && ship.days < 0 ? " · late" : ""}
                  </span>
                </div>

                {/* items */}
                <div>
                  {strip.items.map(it => {
                    const checked = sel.has(it.itemId);
                    const blocked = selVendor !== null && it.decoratorId !== selVendor && !checked;
                    const sizes = sortSizes(Object.keys(it.owed).length ? Object.keys(it.owed) : Object.keys(it.ordered));
                    return (
                      <label key={it.itemId}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: `1px solid ${T.border}`, cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.4 : 1, background: checked ? T.blueDim : "transparent" }}>
                        <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(it)}
                          style={{ width: 16, height: 16, accentColor: T.blue, cursor: blocked ? "not-allowed" : "pointer" }} />
                        {it.mockupColor
                          ? <span title={it.mockupColor} style={{ width: 18, height: 18, borderRadius: 5, background: it.mockupColor, border: `1px solid ${T.border}`, flexShrink: 0 }} />
                          : <span style={{ width: 18, height: 18, borderRadius: 5, background: T.accentDim, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13, fontWeight: 500, minWidth: 180 }}>{it.name}</span>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                          {sizes.map(sz => (
                            <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 34, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, letterSpacing: 0.3 }}>{sz}</span>
                              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{it.owed[sz] ?? it.ordered[sz] ?? 0}</span>
                            </span>
                          ))}
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, minWidth: 44, textAlign: "right" }}>{it.owedTotal}</span>
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
      {kpi && <KpiModal metric={kpi} total={agg.total} byVendor={agg.byVendor} byClient={agg.byClient} onClose={() => setKpi(null)} />}
    </div>
  );
}

// KPI breakdown modal — one metric, split by vendor and by client.
function KpiModal({ metric, total, byVendor, byClient, onClose }:
  { metric: MetricKey; total: Metric; byVendor: Map<string, Metric>; byClient: Map<string, Metric>; onClose: () => void }) {
  const label = METRICS.find(m => m.key === metric)!.label;
  const rows = (m: Map<string, Metric>) =>
    Array.from(m.entries()).map(([name, v]) => ({ name, value: v[metric] }))
      .filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  const vendors = rows(byVendor), clients = rows(byClient);
  const Col = ({ title, data }: { title: string; data: { name: string; value: number }[] }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {data.map(r => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{nf(r.value)}</span>
          </div>
        ))}
        {data.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>None</span>}
      </div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, maxWidth: 620, width: "100%", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span>
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.muted }}>{nf(total[metric])}</span>
          <span style={{ fontSize: 12, color: T.faint }}>total in production</span>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", gap: 28 }}>
          <Col title="By vendor" data={vendors} />
          <Col title="By client" data={clients} />
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Ship modal — PREVIEW. Layout + per-item qty/final controls are real so the
// flow can be reviewed; the confirm (write) is wired in the next slice.
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
          <span style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>Preview — confirm/write is the next slice</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
          <button disabled style={{ fontSize: 13, fontWeight: 600, background: T.accentDim, color: T.faint, border: "none", borderRadius: 8, padding: "9px 20px", cursor: "not-allowed" }}>Confirm ship</button>
        </div>
      </div>
    </div>
  );
}
