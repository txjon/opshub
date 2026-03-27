"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, sortSizes } from "@/lib/theme";
import Link from "next/link";

const SHIP_STAGES = [
  { id: "allocated", label: "Allocated / Staged", color: "#BA7517" },
  { id: "instation", label: "In ShipStation", color: "#534AB7" },
  { id: "complete", label: "Fulfillment Complete", color: "#3B6D11" },
];
const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

type JobGroup = {
  job: any;
  items: any[];
  rxData: Record<string, any>;
  shipStage: string | null;
  shipNotes: string;
};

export default function WarehousePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [jobGroups, setJobGroups] = useState<JobGroup[]>([]);
  const [rxExp, setRxExp] = useState<Record<string, boolean>>({});
  const rxSaveTimer = useRef<any>(null);
  const shipSaveTimers = useRef<Record<string, any>>({});

  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: "13px", fontFamily: font, boxSizing: "border-box" };
  const lc: React.CSSProperties = { fontSize: "12px", color: T.muted, marginBottom: "4px", display: "block" };
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "1rem 1.25rem" };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);

    // Fetch all jobs with their items
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, phase, clients(name)")
      .order("created_at", { ascending: false });

    if (!jobs || jobs.length === 0) { setJobGroups([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)")
      .in("job_id", jobIds)
      .order("sort_order");

    const groups: JobGroup[] = [];
    for (const job of jobs) {
      const jobItems = (allItems || []).filter((it: any) => it.job_id === job.id);
      if (jobItems.length === 0) continue;

      const rxData: Record<string, any> = {};
      const mapped = jobItems.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const sizes = sortSizes(lines.map((l: any) => l.size));
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));

        if (it.receiving_data) {
          rxData[it.id] = it.receiving_data;
        } else {
          const hasRxData = lines.some((l: any) => (l.qty_shipped_from_vendor || 0) > 0 || (l.qty_received_at_hpd || 0) > 0);
          if (hasRxData) {
            rxData[it.id] = {
              shipped: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_shipped_from_vendor || 0])),
              received: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_received_at_hpd || 0])),
            };
          }
        }

        return { ...it, sizes, qtys };
      });

      // Only include jobs that have shipped items or receiving data
      const hasWarehouseItems = mapped.some((it: any) => it.pipeline_stage === "shipped" || rxData[it.id]);
      const meta = job.type_meta || {};
      const hasShipData = !!meta.ship_stage;

      if (!hasWarehouseItems && !hasShipData) continue;

      groups.push({
        job,
        items: mapped,
        rxData,
        shipStage: meta.ship_stage || null,
        shipNotes: meta.ship_notes || "",
      });
    }

    setJobGroups(groups);
    setLoading(false);
  }

  // ── Receiving save ──────────────────────────────────────────────────────
  const saveRxToDb = useCallback(async (itemId: string, data: any) => {
    await supabase.from("items").update({ receiving_data: data }).eq("id", itemId);
    if (data.shipped) {
      for (const [size, qty] of Object.entries(data.shipped)) {
        await supabase.from("buy_sheet_lines").update({ qty_shipped_from_vendor: qty }).eq("item_id", itemId).eq("size", size);
      }
    }
    if (data.received) {
      for (const [size, qty] of Object.entries(data.received)) {
        await supabase.from("buy_sheet_lines").update({ qty_received_at_hpd: qty }).eq("item_id", itemId).eq("size", size);
      }
    }
  }, [supabase]);

  const updRx = (jobIdx: number, itemId: string, patch: any) => {
    setJobGroups(prev => {
      const next = [...prev];
      const g = { ...next[jobIdx], rxData: { ...next[jobIdx].rxData, [itemId]: { ...next[jobIdx].rxData[itemId], ...patch } } };
      next[jobIdx] = g;
      if (rxSaveTimer.current) clearTimeout(rxSaveTimer.current);
      rxSaveTimer.current = setTimeout(() => saveRxToDb(itemId, g.rxData[itemId]), 800);
      return next;
    });
  };

  const updRxNested = (jobIdx: number, itemId: string, key: string, sz: string, val: number) => {
    setJobGroups(prev => {
      const next = [...prev];
      const g = { ...next[jobIdx] };
      g.rxData = { ...g.rxData, [itemId]: { ...g.rxData[itemId], [key]: { ...(g.rxData[itemId]?.[key] || {}), [sz]: val } } };
      next[jobIdx] = g;
      if (rxSaveTimer.current) clearTimeout(rxSaveTimer.current);
      rxSaveTimer.current = setTimeout(() => saveRxToDb(itemId, g.rxData[itemId]), 800);
      return next;
    });
  };

  // ── Shipping save ───────────────────────────────────────────────────────
  const saveShipToDb = useCallback(async (jobId: string, meta: any, stage: string | null, notes: string) => {
    const updated = { ...(meta || {}), ship_stage: stage, ship_notes: notes };
    await supabase.from("jobs").update({ type_meta: updated }).eq("id", jobId);
  }, [supabase]);

  const updShip = (jobIdx: number, stage: string | null, notes: string) => {
    setJobGroups(prev => {
      const next = [...prev];
      next[jobIdx] = { ...next[jobIdx], shipStage: stage, shipNotes: notes };
      const job = next[jobIdx].job;
      if (shipSaveTimers.current[job.id]) clearTimeout(shipSaveTimers.current[job.id]);
      shipSaveTimers.current[job.id] = setTimeout(() => saveShipToDb(job.id, job.type_meta, stage, notes), 800);
      return next;
    });
  };

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Warehouse</h1>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ ...card, marginBottom: 12, height: 80, opacity: 0.5 }}>
            <div style={{ width: "40%", height: 14, background: T.surface, borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: "60%", height: 10, background: T.surface, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  if (jobGroups.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Warehouse</h1>
        <div style={{ ...card, textAlign: "center", padding: "3rem", color: T.muted, fontSize: 13 }}>
          No items in warehouse pipeline. Items appear here when marked as Shipped in Production.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Warehouse</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* ── Receiving column ─────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Receiving</div>

          {jobGroups.filter(g => g.items.some(it => it.pipeline_stage === "shipped" || g.rxData[it.id])).length === 0 ? (
            <div style={{ ...card, textAlign: "center", fontSize: 12, color: T.muted, padding: "2rem" }}>No items awaiting receiving</div>
          ) : (
            jobGroups.map((group, gi) => {
              const { job, items, rxData } = group;
              const clientName = (job as any).clients?.name || "";
              const receivingItems = items.filter(it => it.pipeline_stage === "shipped" || rxData[it.id]);
              if (receivingItems.length === 0) return null;

              // Qty mismatch
              const shorts = receivingItems.filter(it => rxData[it.id]?.received).map(it => {
                const ordered = tQty(it.qtys || {});
                const received = Object.values(rxData[it.id]?.received || {}).reduce((a: number, v: any) => a + v, 0) as number;
                return received < ordered ? { name: it.name, short: ordered - received } : null;
              }).filter(Boolean);

              return (
                <div key={job.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.title}</Link>
                    {job.job_number && <span style={{ fontSize: 11, color: T.muted }}>#{job.job_number}</span>}
                    {clientName && <span style={{ fontSize: 11, color: T.muted }}>— {clientName}</span>}
                  </div>
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {shorts.length > 0 && (
                      <div style={{ background: "#3d1212", border: "1px solid #f0535344", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#f05353" }}>
                        <strong>Qty mismatch:</strong> {shorts.map((s: any) => `${s.name} (${s.short} short)`).join(", ")}
                      </div>
                    )}
                    {receivingItems.map(item => {
                      const rx = rxData[item.id] || {};
                      const isExp = rxExp[item.id];
                      const isRxd = !!rx.receivedAt;
                      const ordered = tQty(item.qtys || {});
                      return (
                        <div key={item.id} style={{ background: T.surface, border: `0.5px solid ${isRxd ? "#C0DD97" : T.border}`, borderRadius: 8, overflow: "hidden" }}>
                          <div onClick={() => setRxExp(p => ({ ...p, [item.id]: !p[item.id] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", background: isRxd ? "#EAF3DE44" : "transparent" }}>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</span>
                              {item.blank_sku && <span style={{ fontSize: 11, color: T.muted, marginLeft: 6 }}>{item.blank_sku}</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              {isRxd ? <span style={{ color: "#3B6D11", fontWeight: 500 }}>Received {rx.receivedAt}</span> : <span style={{ color: T.muted }}>{ordered.toLocaleString()} expected</span>}
                              {rx.location && <span style={{ background: T.card, padding: "1px 7px", borderRadius: 6, fontSize: 11 }}>{rx.location}</span>}
                              <span style={{ fontSize: 10, color: T.muted }}>{isExp ? "▲" : "▼"}</span>
                            </div>
                          </div>
                          {isExp && (
                            <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                <div><label style={lc}>Carrier</label><input style={ic} value={rx.carrier || ""} onChange={e => updRx(gi, item.id, { carrier: e.target.value })} placeholder="UPS, FedEx..." /></div>
                                <div><label style={lc}>Tracking #</label><input style={ic} value={rx.trackingNum || ""} onChange={e => updRx(gi, item.id, { trackingNum: e.target.value })} placeholder="1Z999AA1..." /></div>
                                <div><label style={lc}>Storage location</label><input style={ic} value={rx.location || ""} onChange={e => updRx(gi, item.id, { location: e.target.value })} placeholder="Rack B, Shelf 3" /></div>
                              </div>
                              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", border: `1px solid ${T.border}` }}>
                                <thead><tr style={{ background: T.card }}>
                                  {["Size", "Ordered", "Shipped", "Var 1", "Received", "Var 2"].map(h => <th key={h} style={{ padding: "5px 8px", textAlign: "center", fontSize: 11, fontWeight: 500, color: T.muted, borderRight: `0.5px solid ${T.border}` }}>{h}</th>)}
                                </tr></thead>
                                <tbody>{(item.sizes || []).map((sz: string, si: number) => {
                                  const oq = (item.qtys || {})[sz] || 0;
                                  const sq = rx.shipped?.[sz] ?? null;
                                  const rq = rx.received?.[sz] ?? null;
                                  const v1 = sq !== null ? sq - oq : null;
                                  const v2 = sq !== null && rq !== null ? rq - sq : null;
                                  return (
                                    <tr key={sz} style={{ borderBottom: si < (item.sizes || []).length - 1 ? `0.5px solid ${T.border}` : "none" }}>
                                      <td style={{ padding: "5px 8px", textAlign: "center", fontWeight: 500, borderRight: `0.5px solid ${T.border}` }}>{sz}</td>
                                      <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: "var(--font-mono)", color: T.muted, borderRight: `0.5px solid ${T.border}` }}>{oq}</td>
                                      <td style={{ padding: "3px 4px", textAlign: "center", borderRight: `0.5px solid ${T.border}` }}><input type="number" min="0" value={sq ?? oq} onChange={e => updRxNested(gi, item.id, "shipped", sz, parseInt(e.target.value) || 0)} style={{ width: 48, textAlign: "center", padding: "2px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: v1 !== null && v1 < 0 ? "#A32D2D" : T.text, fontSize: 12, fontFamily: "var(--font-mono)" }} /></td>
                                      <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: v1 === null ? T.muted : v1 < 0 ? "#A32D2D" : v1 > 0 ? "#3B6D11" : T.muted, borderRight: `0.5px solid ${T.border}` }}>{v1 === null ? "—" : v1 === 0 ? "—" : (v1 > 0 ? "+" : "") + v1}</td>
                                      <td style={{ padding: "3px 4px", textAlign: "center", borderRight: `0.5px solid ${T.border}` }}><input type="number" min="0" value={rq ?? (sq ?? oq)} onChange={e => updRxNested(gi, item.id, "received", sz, parseInt(e.target.value) || 0)} style={{ width: 48, textAlign: "center", padding: "2px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: v2 !== null && v2 < 0 ? "#A32D2D" : T.text, fontSize: 12, fontFamily: "var(--font-mono)" }} /></td>
                                      <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: v2 === null ? T.muted : v2 < 0 ? "#A32D2D" : v2 > 0 ? "#3B6D11" : T.muted }}>{v2 === null ? "—" : v2 === 0 ? "—" : (v2 > 0 ? "+" : "") + v2}</td>
                                    </tr>
                                  );
                                })}</tbody>
                              </table>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: T.muted }}>Condition:</span>
                                {["Good", "Damaged"].map(opt => (
                                  <button key={opt} onClick={() => updRx(gi, item.id, { condition: opt })} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: `1px solid ${T.border}`, background: rx.condition === opt ? (opt === "Good" ? "#EAF3DE" : "#FAEEDA") : T.card, color: rx.condition === opt ? (opt === "Good" ? "#27500A" : "#854F0B") : T.muted }}>{opt}</button>
                                ))}
                              </div>
                              {!isRxd && (
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <button onClick={() => updRx(gi, item.id, { receivedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) })} style={{ padding: "6px 18px", borderRadius: 6, background: "#639922", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Mark Received</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Shipping column ──────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Shipping</div>

          {jobGroups.length === 0 ? (
            <div style={{ ...card, textAlign: "center", fontSize: 12, color: T.muted, padding: "2rem" }}>No jobs in shipping pipeline</div>
          ) : (
            jobGroups.map((group, gi) => {
              const { job, items, rxData, shipStage, shipNotes } = group;
              const clientName = (job as any).clients?.name || "";

              return (
                <div key={job.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.title}</Link>
                    {job.job_number && <span style={{ fontSize: 11, color: T.muted }}>#{job.job_number}</span>}
                    {clientName && <span style={{ fontSize: 11, color: T.muted }}>— {clientName}</span>}
                  </div>
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Receiving handoff summary */}
                    {Object.keys(rxData).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: T.muted, marginBottom: 6 }}>Receiving handoff</div>
                        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                          <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}>
                            {["Item", "Location", "Ordered", "Received", "Status"].map(h => <th key={h} style={{ padding: "5px 8px", textAlign: ["Ordered", "Received"].includes(h) ? "center" : "left", color: T.muted, fontWeight: 500, fontSize: 11 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>{Object.entries(rxData).map(([id, rx]) => {
                            const item = items.find((it: any) => it.id === id);
                            if (!item) return null;
                            const ord = tQty(item.qtys || {});
                            const rec = (Object.values(rx.received || {}).reduce((a: number, v: any) => a + v, 0) as number) || ord;
                            const short = rec < ord;
                            return (
                              <tr key={id} style={{ borderBottom: `1px solid ${T.border}` }}>
                                <td style={{ padding: "6px 8px", fontWeight: 500, fontSize: 12 }}>{item.name}</td>
                                <td style={{ padding: "6px 8px", color: T.muted, fontSize: 12 }}>{rx.location || "—"}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12 }}>{ord}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "var(--font-mono)", color: short ? "#A32D2D" : "#3B6D11", fontWeight: 500, fontSize: 12 }}>{rec}</td>
                                <td style={{ padding: "6px 8px" }}>
                                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 500, background: rx.condition === "Damaged" ? "#FAEEDA" : short ? "#FAEEDA" : "#EAF3DE", color: rx.condition === "Damaged" ? "#854F0B" : short ? "#854F0B" : "#27500A" }}>
                                    {rx.condition === "Damaged" ? "Damage" : short ? (rec - ord) + " short" : "OK"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                    )}

                    {/* Fulfillment status */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.muted, marginBottom: 6 }}>Fulfillment status</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        {SHIP_STAGES.map((stage, idx) => {
                          const si = SHIP_STAGES.findIndex(s => s.id === shipStage);
                          const done = si >= idx, active = shipStage === stage.id;
                          return (
                            <button key={stage.id} onClick={() => updShip(gi, stage.id, shipNotes)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: active ? 500 : 400, cursor: "pointer", border: `0.5px solid ${done ? stage.color + "88" : T.border}`, background: active ? stage.color + "22" : done ? stage.color + "11" : "transparent", color: done ? stage.color : T.muted }}>
                              <div style={{ width: 7, height: 7, borderRadius: "50%", background: done ? stage.color : T.border }} />
                              {stage.label}
                            </button>
                          );
                        })}
                      </div>
                      <textarea value={shipNotes} onChange={e => {
                        const val = e.target.value;
                        updShip(gi, shipStage, val);
                      }} placeholder="Internal notes..." style={{ ...ic, minHeight: 60, resize: "vertical", lineHeight: 1.5 }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
