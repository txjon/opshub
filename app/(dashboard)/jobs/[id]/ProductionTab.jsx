"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";

const STAGES = [
  { id: "in_production", label: "In Production", pct: 50 },
  { id: "shipped", label: "Shipped", pct: 100 },
];
const getPct = (s) => (STAGES.find(p => p.id === s) || { pct: 0 }).pct;
const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);
const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

export function ProductionTab({ items, onUpdateItem, onRecalcPhase }) {
  const supabase = createClient();
  const [localFields, setLocalFields] = useState({});
  const saveTimers = useRef({});
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };

  useEffect(() => {
    const fields = {};
    items.forEach(it => {
      fields[it.id] = {
        ship_tracking: it.ship_tracking || "",
        ship_qtys: it.ship_qtys || {},
      };
    });
    setLocalFields(fields);
  }, [items]);

  function updateField(itemId, field, value) {
    setLocalFields(p => ({ ...p, [itemId]: { ...p[itemId], [field]: value } }));
    const key = itemId + "_" + field;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      await supabase.from("items").update({ [field]: value || null }).eq("id", itemId);
      if (field === "ship_tracking" && value) {
        const item = items.find(it => it.id === itemId);
        if (item) logJobActivity(item.job_id, `${item.name} shipped from decorator — tracking: ${value}`);
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

  // Check if blanks are ordered (gate for production)
  const blanksNotOrdered = items.filter(it => !it.blanks_order_number);

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No items yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {blanksNotOrdered.length > 0 && (
        <div style={{ background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.amber }}>
          {blanksNotOrdered.length} item{blanksNotOrdered.length !== 1 ? "s" : ""} without blanks ordered — complete the Blanks tab first
        </div>
      )}

      {items.map(item => {
        const f = localFields[item.id] || {};
        const stage = item.pipeline_stage || "in_production";
        const si = STAGES.findIndex(s => s.id === stage);
        const pct = getPct(stage);
        const totalUnits = tQty(item.qtys || {});

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
                  {item.pipeline_timestamps?.[stage] && (() => {
                    const days = Math.floor((Date.now() - new Date(item.pipeline_timestamps[stage]).getTime()) / (1000 * 60 * 60 * 24));
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
              {STAGES.map((s, idx) => {
                const done = si >= idx, active = stage === s.id;
                return (
                  <button key={s.id} onClick={() => advanceStage(item, s.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6,
                      fontSize: 11, fontWeight: active ? 600 : 400, cursor: "pointer",
                      border: `1px solid ${done ? T.accent + "66" : T.border}`,
                      background: active ? T.accentDim : done ? T.accentDim + "44" : "transparent",
                      color: done ? T.accent : T.muted,
                    }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: done ? T.accent : T.faint, flexShrink: 0 }} />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* Shipped — tracking + qtys */}
            {(stage === "shipped" || f.ship_tracking) && (
              <div style={{ padding: "0 14px 14px" }}>
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

                {f.ship_tracking && (
                  <div style={{ marginTop: 8, background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: T.green }}>
                    Shipped — {item.job_type === "drop_ship" ? "direct to client" : "headed to warehouse for receiving"}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
