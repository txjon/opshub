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

export default function Board({ boxes }: { boxes: ReceivingBox[] }) {
  const [query, setQuery] = useState("");
  const [receiveBox, setReceiveBox] = useState<ReceivingBox | null>(null);

  const display = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boxes;
    return boxes.filter(b =>
      b.vendorName.toLowerCase().includes(q) ||
      (b.tracking || "").toLowerCase().includes(q) ||
      b.clients.some(c => c.toLowerCase().includes(q)) ||
      b.lines.some(l => l.itemName.toLowerCase().includes(q) || (l.invoiceNumber || "").toLowerCase().includes(q)));
  }, [boxes, query]);

  const totalUnits = boxes.reduce((a, b) => a + b.totalUnits, 0);

  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 60 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Receiving</h1>
          <span style={{ fontSize: 12, color: T.faint }}>v2 · parallel dev</span>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0 18px", flexWrap: "wrap" }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vendor, client, invoice, item, or tracking…"
            style={{ flex: 1, minWidth: 240, fontSize: 13, padding: "10px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, outline: "none" }} />
          <span style={{ fontSize: 12, color: T.faint }}>{boxes.length} box{boxes.length === 1 ? "" : "es"} · {totalUnits} units incoming</span>
        </div>

        {display.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>
            {query ? "No boxes match your search." : "Nothing incoming to receive."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {display.map(box => <BoxCard key={box.id} box={box} onReceive={() => setReceiveBox(box)} />)}
        </div>
      </div>

      {receiveBox && <ReceiveModal box={receiveBox} onClose={() => setReceiveBox(null)} />}
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: T.surface }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{box.vendorName}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: box.pickup ? "#a87b00" : T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{box.pickup ? "Pickup" : "Incoming"}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{boxHow(box)}</span>
        {box.slips.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, textDecoration: "none" }}>📎 slip</a>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.faint }}>{fmtWhen(box.createdAt)}</span>
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{box.totalUnits}u</span>
        <button onClick={onReceive} style={{ fontSize: 13, fontWeight: 600, background: T.text, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer" }}>Receive →</button>
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
