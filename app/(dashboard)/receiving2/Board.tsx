"use client";
import { useState, useMemo } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { DriveThumb } from "@/components/DriveThumb";
import type { ReceivingBox, ReceivingLine } from "@/lib/item-state";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const boxHow = (b: ReceivingBox) => b.pickup ? "Pickup" : [b.carrier, b.tracking].filter(Boolean).join(" · ") || "no tracking";
const ROUTE_FG: Record<string, string> = { drop_ship: T.purple, ship_through: T.blue, stage: "#a87b00" };
const ROUTE_LABEL: Record<string, string> = { drop_ship: "Drop-ship", ship_through: "Ship-through", stage: "Stage" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type MetricKey = "boxes" | "units" | "items";
type Metric = { boxes: number; units: number; items: number };
const METRICS: { key: MetricKey; label: string }[] = [{ key: "boxes", label: "Boxes" }, { key: "units", label: "Units" }, { key: "items", label: "Items" }];
const nf = (n: number) => n.toLocaleString();
type ViewKey = "shipment" | "job" | "item";
type FlatLine = ReceivingLine & { box: ReceivingBox };

export default function Board({ boxes }: { boxes: ReceivingBox[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("shipment");
  const [kpi, setKpi] = useState<MetricKey | null>(null);
  const [receiveBox, setReceiveBox] = useState<ReceivingBox | null>(null);

  const matches = (b: ReceivingBox, q: string) =>
    b.vendorName.toLowerCase().includes(q) || (b.tracking || "").toLowerCase().includes(q) ||
    b.clients.some(c => c.toLowerCase().includes(q)) ||
    b.lines.some(l => l.itemName.toLowerCase().includes(q) || (l.invoiceNumber || "").toLowerCase().includes(q));

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? boxes.filter(b => matches(b, q)) : boxes;
  }, [boxes, query]);

  // KPI aggregates over the whole board (like production2)
  const agg = useMemo(() => {
    const total: Metric = { boxes: boxes.length, units: 0, items: 0 };
    const byVendor = new Map<string, Metric>(), byClient = new Map<string, Metric>();
    const bump = (m: Map<string, Metric>, k: string, units: number, isBox: boolean) => {
      const cur = m.get(k) || { boxes: 0, units: 0, items: 0 };
      cur.units += units; cur.items += 1; if (isBox) cur.boxes += 1; m.set(k, cur);
    };
    for (const b of boxes) {
      const vSeen = new Set<string>();
      for (const l of b.lines) {
        const u = tQty(l.shipQtys); total.units += u; total.items += 1;
        bump(byVendor, b.vendorName, u, !vSeen.has(b.vendorName)); vSeen.add(b.vendorName);
        bump(byClient, l.client, u, false);
      }
    }
    return { total, byVendor, byClient };
  }, [boxes]);

  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 60 }}>
      <style>{`.kpi-tile{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}.kpi-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.09);border-color:#c4c4cc}.kpi-tile:active{transform:translateY(0)}`}</style>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Receiving</h1>
          <span style={{ fontSize: 12, color: T.faint }}>v2 · parallel dev</span>
        </div>

        {/* view toggle + search FIRST — same order + pill style as production */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "14px 0 2px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {([["shipment", "By shipment"], ["job", "By job"], ["item", "By item"]] as [ViewKey, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9, cursor: "pointer", border: `1px solid ${view === k ? T.text : T.border}`, background: view === k ? T.text : T.card, color: view === k ? "#fff" : T.muted }}>{label}</button>
            ))}
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vendor, client, invoice, item, or tracking…"
            style={{ flex: 1, minWidth: 220, fontSize: 13, padding: "9px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, outline: "none" }} />
        </div>

        {/* KPIs — same tiles + spacing as production */}
        <div style={{ display: "flex", gap: 12, margin: "16px 0 18px" }}>
          {METRICS.map(m => (
            <button key={m.key} onClick={() => setKpi(m.key)} className="kpi-tile"
              style={{ flex: 1, textAlign: "left", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
              <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, marginTop: 2 }}>{nf(agg.total[m.key])}</div>
            </button>
          ))}
        </div>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No boxes match your search." : "Nothing incoming to receive."}
          </div>
        )}

        {view === "shipment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {display.map(box => <BoxCard key={box.id} box={box} onReceive={() => setReceiveBox(box)} />)}
          </div>
        )}
        {view === "job" && <JobView boxes={display} onReceive={setReceiveBox} />}
        {view === "item" && <ItemView boxes={display} onReceive={setReceiveBox} />}
      </div>

      {kpi && <KpiModal metric={kpi} total={agg.total} byVendor={agg.byVendor} byClient={agg.byClient} onClose={() => setKpi(null)} />}
      {receiveBox && <ReceiveModal box={receiveBox} onClose={() => setReceiveBox(null)} />}
    </div>
  );
}

// By job — group every incoming line by client (+ invoice), across boxes.
function JobView({ boxes, onReceive }: { boxes: ReceivingBox[]; onReceive: (b: ReceivingBox) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { client: string; invoice: string | null; lines: FlatLine[] }>();
    for (const b of boxes) for (const l of b.lines) {
      const key = `${l.client}::${l.invoiceNumber || ""}`;
      const g = m.get(key) || { client: l.client, invoice: l.invoiceNumber, lines: [] };
      g.lines.push({ ...l, box: b }); m.set(key, g);
    }
    return Array.from(m.values());
  }, [boxes]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map((g, i) => (
        <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: T.surface }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{g.client}</span>
            {g.invoice && <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>#{g.invoice}</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{g.lines.reduce((a, l) => a + tQty(l.shipQtys), 0)}u</span>
          </div>
          {g.lines.map((l, j) => <FlatLineRow key={j} line={l} onReceive={() => onReceive(l.box)} showBox />)}
        </div>
      ))}
    </div>
  );
}

// By item — flat list of every incoming line.
function ItemView({ boxes, onReceive }: { boxes: ReceivingBox[]; onReceive: (b: ReceivingBox) => void }) {
  const lines = useMemo(() => boxes.flatMap(b => b.lines.map(l => ({ ...l, box: b }))), [boxes]);
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
      {lines.map((l, i) => <FlatLineRow key={i} line={l} onReceive={() => onReceive(l.box)} showBox showClient />)}
    </div>
  );
}

function FlatLineRow({ line: l, onReceive, showBox, showClient }: { line: FlatLine; onReceive: () => void; showBox?: boolean; showClient?: boolean }) {
  const sizes = sortSizes(Object.keys(l.shipQtys));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: `1px solid ${T.border}`, opacity: l.received ? 0.5 : 1 }}>
      {l.mockupFileId
        ? <DriveThumb driveFileId={l.mockupFileId} alt="" maxRetries={0} enlargeable title={l.itemName}
            style={{ width: 36, height: 36, borderRadius: 7, objectFit: "cover", flexShrink: 0, border: `1px solid ${T.border}`, cursor: "zoom-in" }}
            fallback={<span style={{ width: 36, height: 36, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: T.faint }}>{(l.itemName || "?").charAt(0).toUpperCase()}</span>} />
        : <span style={{ width: 36, height: 36, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: T.faint }}>{(l.itemName || "?").charAt(0).toUpperCase()}</span>}
      <div style={{ minWidth: 170 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{l.itemName}</div>
        {showClient && <div style={{ fontSize: 11, color: T.muted }}>{l.client}{l.invoiceNumber ? ` · #${l.invoiceNumber}` : ""}</div>}
        {showBox && <div style={{ fontSize: 11, color: T.faint }}>{l.box.vendorName} · {boxHow(l.box)}</div>}
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: ROUTE_FG[l.route] || T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{ROUTE_LABEL[l.route] || "Ship-through"}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
        {sizes.map(sz => (
          <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 34, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, letterSpacing: 0.3 }}>{sz}</span>
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{l.shipQtys[sz] ?? 0}</span>
          </span>
        ))}
      </div>
      {l.received
        ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green }}>✓ received</span>
        : <button onClick={onReceive} style={{ fontSize: 12, fontWeight: 600, background: "none", border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", color: T.text }}>Receive box →</button>}
    </div>
  );
}

// KPI breakdown modal — one metric, split by vendor and by client (production std).
function KpiModal({ metric, total, byVendor, byClient, onClose }:
  { metric: MetricKey; total: Metric; byVendor: Map<string, Metric>; byClient: Map<string, Metric>; onClose: () => void }) {
  const label = METRICS.find(m => m.key === metric)!.label;
  const rows = (m: Map<string, Metric>) => Array.from(m.entries()).map(([name, v]) => ({ name, value: v[metric] })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  const Col = ({ title, data }: { title: string; data: { name: string; value: number }[] }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{title}</div>
      {data.map(r => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{nf(r.value)}</span>
        </div>
      ))}
      {data.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>None</span>}
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, maxWidth: 620, width: "100%", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span>
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.muted }}>{nf(total[metric])}</span>
          <span style={{ fontSize: 12, color: T.faint }}>incoming</span>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", gap: 28 }}>
          <Col title="By vendor" data={rows(byVendor)} />
          <Col title="By client" data={rows(byClient)} />
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ClientGroups({ lines, thumbs = true }: { lines: ReceivingLine[]; thumbs?: boolean }) {
  const byClient = new Map<string, ReceivingLine[]>();
  for (const l of lines) { const a = byClient.get(l.client) || []; a.push(l); byClient.set(l.client, a); }
  return (
    <>
      {Array.from(byClient.entries()).map(([client, ls]) => (
        <div key={client} style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 8 }}>
            {client}{ls[0]?.invoiceNumber ? <span style={{ fontFamily: mono, color: T.faint, fontWeight: 500 }}> · #{ls[0].invoiceNumber}</span> : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ls.map(l => {
              const sizes = sortSizes(Object.keys(l.shipQtys));
              return (
                <div key={l.itemId} style={{ display: "flex", alignItems: "center", gap: 12, opacity: l.received ? 0.5 : 1 }}>
                  {thumbs && (l.mockupFileId
                    ? <DriveThumb driveFileId={l.mockupFileId} alt="" maxRetries={0} enlargeable title={l.itemName}
                        style={{ width: 36, height: 36, borderRadius: 7, objectFit: "cover", flexShrink: 0, border: `1px solid ${T.border}`, cursor: "zoom-in" }}
                        fallback={<span style={{ width: 36, height: 36, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: T.faint }}>{(l.itemName || "?").charAt(0).toUpperCase()}</span>} />
                    : <span style={{ width: 36, height: 36, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: T.faint }}>{(l.itemName || "?").charAt(0).toUpperCase()}</span>)}
                  <span style={{ fontSize: 13, fontWeight: 500, minWidth: 150 }}>{l.itemName}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ROUTE_FG[l.route] || T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{ROUTE_LABEL[l.route] || "Ship-through"}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                    {sizes.map(sz => (
                      <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 34, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, letterSpacing: 0.3 }}>{sz}</span>
                        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{l.shipQtys[sz] ?? 0}</span>
                      </span>
                    ))}
                  </div>
                  {l.received
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green }}>✓ received</span>
                    : <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, minWidth: 40, textAlign: "right" }}>{tQty(l.shipQtys)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function BoxCard({ box, onReceive }: { box: ReceivingBox; onReceive: () => void }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{box.vendorName}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: box.pickup ? "#a87b00" : T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{box.pickup ? "Pickup" : "Incoming"}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{boxHow(box)}</span>
        {box.slips.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, textDecoration: "none" }}>📎 slip</a>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.faint }}>{fmtWhen(box.createdAt)}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{box.totalUnits}u</span>
        <span onClick={onReceive} style={{ fontSize: 13, fontWeight: 700, color: T.text, cursor: "pointer" }}>Receive →</span>
      </div>
      <ClientGroups lines={box.lines} />
    </div>
  );
}

// Receive modal — PREVIEW. Per-item per-variant delivered grid (default = shipped);
// under = amber, over = green. Confirm/write is the next slice.
function ReceiveModal({ box, onClose }: { box: ReceivingBox; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const l of box.lines) init[l.itemId] = { ...l.shipQtys };
    return init;
  });
  const setQ = (id: string, sz: string, v: string) =>
    setQtys(prev => ({ ...prev, [id]: { ...prev[id], [sz]: Math.max(0, Math.floor(Number(v) || 0)) } }));
  const byClient = new Map<string, ReceivingLine[]>();
  for (const l of box.lines) { const a = byClient.get(l.client) || []; a.push(l); byClient.set(l.client, a); }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div style={{ background: T.card, borderRadius: 14, maxWidth: 680, width: "100%", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Receive box — {box.vendorName}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{boxHow(box)} · {box.totalUnits} units · count what actually arrived</div>
          {box.slips.length > 0 && <div style={{ marginTop: 8 }}>{box.slips.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.blue, textDecoration: "none", marginRight: 12 }}>📎 {s.name}</a>
          ))}</div>}
        </div>
        <div style={{ padding: "8px 22px 18px" }}>
          {Array.from(byClient.entries()).map(([client, ls]) => (
            <div key={client} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 8 }}>{client}{ls[0]?.invoiceNumber ? ` · #${ls[0].invoiceNumber}` : ""}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ls.map(l => (
                  <div key={l.itemId} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{l.itemName}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {sortSizes(Object.keys(l.shipQtys)).map(sz => {
                        const got = qtys[l.itemId]?.[sz] ?? 0, want = l.shipQtys[sz] ?? 0;
                        const color = got === want ? T.text : got < want ? "#a87b00" : T.green;
                        return (
                          <label key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, marginBottom: 2 }}>{sz} <span style={{ color: T.faint }}>/{want}</span></span>
                            <input inputMode="numeric" value={got} onChange={e => setQ(l.itemId, sz, e.target.value)} onFocus={e => e.target.select()}
                              style={{ width: 46, boxSizing: "border-box", textAlign: "center", fontFamily: mono, fontSize: 12, fontWeight: 700, padding: "5px 4px", borderRadius: 6, border: `1px solid ${got === want ? T.border : color}`, color, background: T.card }} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 22px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>Preview — receive/route write is the next slice</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
          <button disabled style={{ fontSize: 13, fontWeight: 600, background: T.accentDim, color: T.faint, border: "none", borderRadius: 8, padding: "9px 20px", cursor: "not-allowed" }}>Confirm receipt</button>
        </div>
      </div>
    </div>
  );
}
