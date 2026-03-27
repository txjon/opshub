"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";

const PIPELINE_STAGES = [
  { id: "blanks_ordered", label: "Blanks Ordered", pct: 33 },
  { id: "in_production", label: "In Production", pct: 66 },
  { id: "shipped", label: "Shipped", pct: 100 },
];
const getPct = (s) => (PIPELINE_STAGES.find(p => p.id === s) || { pct: 0 }).pct;
const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);

const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

export function ProductionTab({ items, onUpdateItem, onRecalcPhase }) {
  const supabase = createClient();
  const [proofStatus, setProofStatus] = useState({});
  const [localFields, setLocalFields] = useState({});
  const saveTimers = useRef({});
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 0, overflow: "hidden" };

  // Load proof status for art gate
  useEffect(() => {
    if (!items.length) return;
    const ids = items.map(it => it.id);
    supabase.from("item_files").select("item_id, stage, approval").in("item_id", ids).then(({ data }) => {
      const status = {};
      for (const it of items) {
        const files = (data || []).filter(f => f.item_id === it.id);
        const proofs = files.filter(f => f.stage === "proof");
        const hasProof = proofs.length > 0;
        const allApproved = hasProof && proofs.every(f => f.approval === "approved");
        status[it.id] = { hasProof, allApproved };
      }
      setProofStatus(status);
    });
  }, [items]);

  // Initialize local fields from items
  useEffect(() => {
    const fields = {};
    items.forEach(it => {
      fields[it.id] = {
        blanks_order_number: it.blanks_order_number || "",
        blanks_order_cost: it.blanks_order_cost || "",
        ship_tracking: it.ship_tracking || "",
        ship_qtys: it.ship_qtys || {},
      };
    });
    setLocalFields(fields);
  }, [items]);

  function updateField(itemId, field, value) {
    setLocalFields(p => ({ ...p, [itemId]: { ...p[itemId], [field]: value } }));
    // Debounce save
    const key = itemId + "_" + field;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ [field]: value || null }).eq("id", itemId);
      // Log blanks order and shipping tracking
      const item = items.find(it => it.id === itemId);
      if (field === "blanks_order_number" && value && item) {
        logJobActivity(item.job_id, `Blanks ordered for ${item.name} — S&S #${value}`);
      }
      if (field === "ship_tracking" && value && item) {
        logJobActivity(item.job_id, `${item.name} shipped from decorator — tracking: ${value}`);
      }
      if (onRecalcPhase) onRecalcPhase();
    }, 800);
  }

  function updateShipQty(itemId, size, qty) {
    const current = localFields[itemId]?.ship_qtys || {};
    const updated = { ...current, [size]: parseInt(qty) || 0 };
    setLocalFields(p => ({ ...p, [itemId]: { ...p[itemId], ship_qtys: updated } }));
    const key = itemId + "_ship_qtys";
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ ship_qtys: updated }).eq("id", itemId);
    }, 800);
  }

  function advanceStage(item, stageId) {
    onUpdateItem(item.id, { pipeline_stage: stageId, decorator_assignment_id: item.decorator_assignment_id });
    if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
  }

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No items yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map(item => {
        const ps = proofStatus[item.id] || {};
        const f = localFields[item.id] || {};
        const si = PIPELINE_STAGES.findIndex(s => s.id === item.pipeline_stage);
        const pct = getPct(item.pipeline_stage || "blanks_ordered");
        const totalUnits = tQty(item.qtys || {});
        const calcCost = item.cost_per_unit ? (item.cost_per_unit * totalUnits) : null;
        const actualCost = f.blanks_order_cost ? parseFloat(f.blanks_order_cost) : null;
        const costDiff = calcCost && actualCost ? actualCost - calcCost : null;

        return (
          <div key={item.id} style={card}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                  {item.decoration_type && <span style={{ padding: "1px 7px", borderRadius: 6, fontSize: 10, fontWeight: 500, background: T.accentDim, color: T.accent }}>{item.decoration_type.replace(/_/g, " ")}</span>}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {item.decorator || "No decorator"} · {totalUnits.toLocaleString()} units
                  {item.pipeline_timestamps?.[item.pipeline_stage] && (() => {
                    const days = Math.floor((Date.now() - new Date(item.pipeline_timestamps[item.pipeline_stage]).getTime()) / (1000 * 60 * 60 * 24));
                    return days > 0 ? <span style={{ marginLeft: 6, color: days >= 7 ? T.red : days >= 3 ? T.amber : T.faint }}> · {days}d in stage</span> : null;
                  })()}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: pct === 100 ? T.green : T.accent }}>{pct}%</div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: T.surface }}>
              <div style={{ height: "100%", width: pct + "%", background: pct === 100 ? T.green : T.accent, transition: "width 0.3s" }} />
            </div>

            {/* Stage buttons */}
            <div style={{ padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PIPELINE_STAGES.map((stage, idx) => {
                const done = si >= idx, active = item.pipeline_stage === stage.id;
                return (
                  <button key={stage.id}
                    onClick={() => advanceStage(item, stage.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6,
                      fontSize: 11, fontWeight: active ? 600 : 400, cursor: "pointer",
                      border: `1px solid ${done ? T.accent + "66" : T.border}`,
                      background: active ? T.accentDim : done ? T.accentDim + "44" : "transparent",
                      color: done ? T.accent : T.muted,
                    }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: done ? T.accent : T.faint, flexShrink: 0 }} />
                    {stage.label}
                  </button>
                );
              })}
            </div>

            {/* Stage-specific content */}
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

              {/* Blanks Ordered — order number + cost */}
              {(item.pipeline_stage === "blanks_ordered" || f.blanks_order_number) && (
                <div style={{ background: T.surface, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Blanks Order</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>S&S Order #</label>
                      <input style={ic} value={f.blanks_order_number || ""} placeholder="e.g. SO-123456"
                        onChange={e => updateField(item.id, "blanks_order_number", e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Order total</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input style={{ ...ic, fontFamily: mono }} type="text" inputMode="decimal" value={f.blanks_order_cost || ""} placeholder="0.00"
                          onChange={e => updateField(item.id, "blanks_order_cost", e.target.value)}
                          onFocus={e => e.target.select()} />
                        {calcCost && actualCost && (
                          <span style={{ fontSize: 10, fontFamily: mono, fontWeight: 600, flexShrink: 0, color: costDiff > 0 ? T.red : costDiff < 0 ? T.green : T.faint }}>
                            {costDiff === 0 ? "match" : (costDiff > 0 ? "+" : "") + "$" + Math.abs(costDiff).toFixed(2)}
                          </span>
                        )}
                      </div>
                      {calcCost && <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>Calculated: ${calcCost.toFixed(2)}</div>}
                    </div>
                  </div>
                </div>
              )}

              {/* Art approval gate */}
              {item.pipeline_stage === "in_production" && !ps.allApproved && (
                <div style={{ background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: T.amber }}>
                  {!ps.hasProof ? "No proofs uploaded yet — upload in Art Files tab" : "Proofs pending approval — approve in Art Files tab"}
                </div>
              )}
              {item.pipeline_stage === "in_production" && ps.allApproved && (
                <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: T.green }}>
                  All proofs approved — cleared for production
                </div>
              )}

              {/* Shipped — tracking + qtys */}
              {(item.pipeline_stage === "shipped" || f.ship_tracking) && (
                <div style={{ background: T.surface, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Shipping from Decorator</div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Tracking #</label>
                    <input style={{ ...ic, fontFamily: mono }} value={f.ship_tracking || ""} placeholder="Enter tracking number"
                      onChange={e => updateField(item.id, "ship_tracking", e.target.value)} />
                  </div>
                  {item.sizes?.length > 0 && (
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 6, display: "block" }}>Shipped quantities</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {item.sizes.map(sz => {
                          const ordered = item.qtys?.[sz] || 0;
                          const shipped = f.ship_qtys?.[sz] ?? ordered;
                          const mismatch = shipped !== ordered;
                          return (
                            <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 9, color: T.muted, fontFamily: mono }}>{sz}</span>
                              <input type="number" min="0" value={shipped}
                                onChange={e => updateShipQty(item.id, sz, e.target.value)}
                                onFocus={e => e.target.select()}
                                style={{ width: 44, textAlign: "center", padding: "3px", border: `1px solid ${mismatch ? T.amber : T.border}`, borderRadius: 4, background: T.card, color: mismatch ? T.amber : T.text, fontSize: 11, fontFamily: mono, outline: "none" }} />
                              <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{ordered}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Shipped complete message */}
              {item.pipeline_stage === "shipped" && f.ship_tracking && (
                <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: T.green }}>
                  Shipped — {item.job_type === "drop_ship" ? "direct to client" : "headed to warehouse for receiving"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
