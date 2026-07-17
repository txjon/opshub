"use client";
import { useMemo, useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { fmtDay, daysUntilDay } from "@/lib/dates";
import { BoardFrame, ModalShell, Card, RouteTag, VariantChips } from "@/components/board-kit";
import { TrackingLink } from "@/components/TrackingModal";

// /distro board — READ-ONLY arrival radar (locked mockup 2026-07-16).
// Left: arrivals bucketed by expected day. Right: drops scheduled.
// Clicking a row or drop opens a viewable-details modal; nothing edits here —
// actions live on /production2 and /receiving2.

export type ArrivalLine = {
  name: string; client?: string; route: string;
  qtys: Record<string, number>; receivedQtys?: Record<string, number>;
  orderedTotal?: number; shippedTotal?: number;
};
export type ArrivalRow = {
  kind: "box" | "strip"; id: string;
  client: string; vendor: string; itemsLabel: string; units: number;
  eta: string | null;
  etaSource: "carrier" | "human" | "derived" | null; // plain date = carrier data; ~ = any estimate
  deliveredAt?: string | null;      // boxes: carrier says delivered (≠ received — human truth)
  stall?: { text: string; severe: boolean } | null; // tracked box whose carrier feed went quiet
  shipBy?: string | null;           // strips: the vendor ship-by ("ASAP" possible)
  shippedAt?: string;               // boxes: when it left the vendor
  carrier?: string | null; tracking?: string | null; pickup?: boolean;
  note?: string | null; slips?: { name: string; url: string }[];
  lines: ArrivalLine[];
};
export type DropRow = {
  id: string; name: string; client: string | null; status: string; platform: string | null;
  openDate: string | null; closeDate: string | null; targetShipDate: string | null; totalUnits: number | null;
};

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const dayOf = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// delivered-not-received aging (D3): calm <24h · amber 24–48h · red 48h+
function deliveredMeta(iso: string): { text: string; color: string } {
  const ageH = (Date.now() - new Date(iso).getTime()) / 36e5;
  const color = ageH >= 48 ? T.red : ageH >= 24 ? T.amber : T.green;
  const ago = ageH < 1 ? "just now" : ageH < 24 ? `${Math.floor(ageH)}h ago` : `${Math.floor(ageH / 24)}d ago`;
  return { text: `✓ ${dayOf(iso)} · ${ago}`, color };
}

// urgency-coded ETA (signal table): red late · amber ≤3d · gray calm · faint TBD
function etaMeta(row: ArrivalRow): { text: string; color: string } {
  if (row.deliveredAt) return deliveredMeta(row.deliveredAt);
  if (!row.eta) return { text: row.shipBy === "ASAP" ? "ASAP · TBD" : "TBD", color: T.faint };
  const d = daysUntilDay(row.eta);
  const pre = row.etaSource !== "carrier" ? "~" : ""; // ~ = estimate (human or math); plain = carrier

  if (d != null && d < 0) return { text: `${pre}${fmtDay(row.eta)} · late`, color: T.red };
  if (d === 0) return { text: "today", color: T.amber };
  const color = d != null && d <= 3 ? T.amber : T.muted;
  return { text: `${pre}${fmtDay(row.eta)}`, color };
}

const BUCKETS: { key: string; label: string; match: (d: number | null) => boolean }[] = [
  { key: "today", label: "Today", match: d => d != null && d <= 0 },
  { key: "week", label: "This week", match: d => d != null && d >= 1 && d <= 7 },
  { key: "next", label: "Next week", match: d => d != null && d >= 8 && d <= 14 },
  { key: "later", label: "Later", match: d => d != null && d > 14 },
  { key: "tbd", label: "No date yet", match: d => d == null },
];

export default function Board({ rows, drops }: { rows: ArrivalRow[]; drops: DropRow[] }) {
  const [detail, setDetail] = useState<ArrivalRow | null>(null);
  const [dropDetail, setDropDetail] = useState<DropRow | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const buckets = useMemo(() => {
    // carrier-delivered boxes leave the date buckets — they're not "arriving",
    // they're SITTING on the dock unreceived. Pinned first, newest-delivered
    // first (mirrors receiving2's queue).
    const dock = rows.filter(r => r.deliveredAt)
      .sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || ""));
    const rest = rows.filter(r => !r.deliveredAt);
    const sorted = [...rest].sort((a, b) => (a.eta || "9999").localeCompare(b.eta || "9999"));
    const dated = BUCKETS.map(bk => ({ ...bk, rows: sorted.filter(r => bk.match(r.eta ? daysUntilDay(r.eta) : null)) }));
    return [{ key: "dock", label: "On the dock — not received", rows: dock }, ...dated]
      .filter(bk => bk.rows.length > 0);
  }, [rows]);

  const kpis = useMemo(() => {
    const withEta = (r: ArrivalRow) => (r.eta ? daysUntilDay(r.eta) : null);
    const arrivingWeek = rows.filter(r => { const d = withEta(r); return d != null && d <= 7; })
      .reduce((a, r) => a + r.units, 0);
    const inTransit = rows.filter(r => r.kind === "box" && !r.deliveredAt).length;
    const atVendors = rows.filter(r => r.kind === "strip").reduce((a, r) => a + r.units, 0);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const nextDrop = drops.filter(d => (d.openDate || "") >= todayStr).sort((a, b) => (a.openDate || "9999").localeCompare(b.openDate || "9999"))[0];
    return { arrivingWeek, inTransit, atVendors, nextDrop };
  }, [rows, drops]);

  const kpiCard: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" };
  const bucketLabel: React.CSSProperties = { fontSize: 10.5, color: T.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, margin: "20px 0 8px" };

  return (
    <BoardFrame title="Distro">
      <div style={{ fontSize: 12, color: T.muted, marginTop: -2, marginBottom: 16 }}>What's landing, and when — glance here, act on Production / Receiving.</div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 8 }}>
        <div style={kpiCard}><div style={{ fontSize: 26, fontWeight: 800, fontFamily: mono, color: T.green }}>{kpis.arrivingWeek.toLocaleString()}</div><div style={{ fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 }}>Units arriving this week</div></div>
        <div style={kpiCard}><div style={{ fontSize: 26, fontWeight: 800, fontFamily: mono, color: T.blue }}>{kpis.inTransit}</div><div style={{ fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 }}>Boxes in transit</div></div>
        <div style={kpiCard}><div style={{ fontSize: 26, fontWeight: 800, fontFamily: mono, color: "#a87b00" }}>{kpis.atVendors.toLocaleString()}</div><div style={{ fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 }}>Still at vendors</div></div>
        <div style={kpiCard}><div style={{ fontSize: 26, fontWeight: 800, fontFamily: mono, color: T.purple }}>{kpis.nextDrop?.openDate ? fmtDay(kpis.nextDrop.openDate) : "—"}</div><div style={{ fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 }}>Next drop</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, alignItems: "start" }}>
        {/* left: arrivals */}
        <div>
          {buckets.length === 0 && (
            <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 20 }}>
              Nothing inbound — no open POs or boxes in transit.
            </div>
          )}
          {buckets.map(bk => (
            <div key={bk.key}>
              <div style={{ ...bucketLabel, ...(bk.key === "dock" ? { color: T.red } : {}) }}>{bk.label}</div>
              {bk.rows.map(r => {
                const eta = etaMeta(r);
                return (
                  <div key={r.id} onClick={() => setDetail(r)}
                    onMouseEnter={() => setHoverId(r.id)} onMouseLeave={() => setHoverId(null)}
                    style={{ cursor: "pointer", borderRadius: 12, outline: hoverId === r.id ? `1.5px solid ${T.text}` : r.deliveredAt && eta.color !== T.green ? `2px solid ${eta.color}` : "none", outlineOffset: -1, marginBottom: 8 }}>
                    <Card>
                      <div style={{ padding: "9px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 800 }}>{r.client}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: r.deliveredAt ? eta.color : r.kind === "box" ? T.blue : T.green }}>
                              {r.deliveredAt ? "Delivered" : r.kind === "box" ? "In transit" : "At vendor"}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, fontSize: 11.5, color: T.faint, flexWrap: "wrap" }}>
                            <span>from <span style={{ color: T.muted, fontWeight: 700 }}>{r.vendor}</span></span>
                            <span style={{ opacity: 0.6 }}>·</span><span>{r.itemsLabel}</span>
                            {r.kind === "strip" && r.shipBy && <><span style={{ opacity: 0.6 }}>·</span><span>ships {r.shipBy === "ASAP" ? "ASAP" : `~${fmtDay(r.shipBy)}`}</span></>}
                            {r.stall && <><span style={{ opacity: 0.6 }}>·</span><span title="The carrier feed went quiet — check with the vendor/carrier" style={{ color: r.stall.severe ? T.red : T.amber, fontWeight: 800 }}>⚠ {r.stall.text}</span></>}
                          </div>
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.muted, whiteSpace: "nowrap" }}>{r.units.toLocaleString()}u</span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: eta.color, whiteSpace: "nowrap" }}>{eta.text}</span>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* right: drops */}
        <div>
          <div style={{ ...bucketLabel, marginTop: 20 }}>Drops scheduled</div>
          {drops.length === 0 && <div style={{ fontSize: 12.5, color: T.faint, padding: "12px 2px" }}>No drops on the calendar.</div>}
          {drops.map(d => (
            <div key={d.id} onClick={() => setDropDetail(d)}
              onMouseEnter={() => setHoverId(d.id)} onMouseLeave={() => setHoverId(null)}
              style={{ cursor: "pointer", borderRadius: 12, outline: hoverId === d.id ? `1.5px solid ${T.text}` : "none", outlineOffset: -1, marginBottom: 8 }}>
              <Card>
                <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{d.client ? `${d.client} · ` : ""}{d.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.purple }}>
                    {d.openDate ? `opens ${fmtDay(d.openDate)}` : d.closeDate ? `closes ${fmtDay(d.closeDate)}` : "—"}
                  </span>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* arrival details — read-only */}
      {detail && (
        <ModalShell onClose={() => setDetail(null)} maxWidth={560}>
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{detail.client}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              from {detail.vendor}
              {detail.kind === "box"
                ? <> · shipped {dayOf(detail.shippedAt)}{detail.pickup ? " · pickup" : (detail.carrier || detail.tracking) ? <> · {detail.carrier}{detail.carrier && detail.tracking ? " · " : ""}{detail.tracking && <TrackingLink tracking={detail.tracking} shipmentId={detail.id} />}</> : ""}</>
                : <> · ships {detail.shipBy === "ASAP" ? "ASAP" : detail.shipBy ? `~${fmtDay(detail.shipBy)}` : "TBD"}</>}
              {" · "}<span style={{ color: etaMeta(detail).color, fontWeight: 700 }}>{detail.deliveredAt ? "delivered" : "ETA"} {etaMeta(detail).text}</span>
            </div>
            {detail.slips && detail.slips.length > 0 && (
              <div style={{ marginTop: 6 }}>{detail.slips.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.blue, textDecoration: "none", marginRight: 12 }}>📎 {s.name}</a>
              ))}</div>
            )}
            {detail.note && <div style={{ marginTop: 8, fontSize: 12, borderLeft: `3px solid ${T.purple}`, paddingLeft: 8, color: T.text }}>{detail.note}</div>}
          </div>
          <div style={{ padding: "10px 22px 16px" }}>
            {detail.lines.map((l, i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: i < detail.lines.length - 1 ? `1px solid ${T.border}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{l.name}</span>
                  <RouteTag route={l.route} />
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{tQty(l.qtys)}</span>
                </div>
                <div style={{ marginTop: 5 }}><VariantChips qtys={l.qtys} max={10} /></div>
                {detail.kind === "box" && l.receivedQtys && tQty(l.receivedQtys) > 0 && (
                  <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, marginTop: 4 }}>{tQty(l.receivedQtys)} already counted in</div>
                )}
                {detail.kind === "strip" && l.shippedTotal != null && l.shippedTotal > 0 && (
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{l.shippedTotal} of {l.orderedTotal} already shipped — these are the owed units</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a href={detail.kind === "box" ? "/receiving2" : "/production2"} style={{ fontSize: 12, fontWeight: 700, color: T.blue, textDecoration: "none", fontFamily: font }}>
              {detail.kind === "box" ? "Act on Receiving →" : "Act on Production →"}
            </a>
            <button onClick={() => setDetail(null)} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", color: T.muted }}>Close</button>
          </div>
        </ModalShell>
      )}

      {/* drop details — read-only */}
      {dropDetail && (
        <ModalShell onClose={() => setDropDetail(null)} maxWidth={440}>
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{dropDetail.name}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{dropDetail.client || "—"}{dropDetail.platform ? ` · ${dropDetail.platform}` : ""} · {dropDetail.status}</div>
          </div>
          <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div><span style={{ color: T.faint, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Opens</span> &nbsp;{dropDetail.openDate ? fmtDay(dropDetail.openDate) : "—"}</div>
            <div><span style={{ color: T.faint, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Closes</span> &nbsp;{dropDetail.closeDate ? fmtDay(dropDetail.closeDate) : "—"}</div>
            <div><span style={{ color: T.faint, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Target ship</span> &nbsp;{dropDetail.targetShipDate ? fmtDay(dropDetail.targetShipDate) : "—"}</div>
            {dropDetail.totalUnits != null && <div><span style={{ color: T.faint, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Units</span> &nbsp;{dropDetail.totalUnits.toLocaleString()}</div>}
          </div>
          <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a href={`/ecomm/${dropDetail.id}`} style={{ fontSize: 12, fontWeight: 700, color: T.blue, textDecoration: "none", fontFamily: font }}>Open in E-Comm →</a>
            <button onClick={() => setDropDetail(null)} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", color: T.muted }}>Close</button>
          </div>
        </ModalShell>
      )}
    </BoardFrame>
  );
}
