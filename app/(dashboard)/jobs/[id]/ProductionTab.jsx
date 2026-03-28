"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";

const getPct = (s) => {
  if (s === "shipped") return 100;
  return 50; // in_production
};
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
        // Auto-advance to shipped when tracking is entered
        await supabase.from("items").update({ pipeline_stage: "shipped" }).eq("id", itemId);
        const item = items.find(it => it.id === itemId);
        if (item) {
          logJobActivity(item.job_id, `${item.name} shipped from decorator — tracking: ${value}`);
          notifyTeam(`${item.name} shipped from decorator — incoming to warehouse`, "production", item.job_id, "job");
          if (item.decorator_assignment_id) {
            await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
          }
          onUpdateItem(itemId, { pipeline_stage: "shipped", decorator_assignment_id: item.decorator_assignment_id });
        }
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

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No items yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {items.map(item => {
        const f = localFields[item.id] || {};
        const stage = item.pipeline_stage || "in_production";
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

            {/* Tracking + qtys — always visible, entering tracking auto-advances to shipped */}
              <div style={{ padding: "10px 14px" }}>
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
                    Shipped — headed to warehouse for receiving
                  </div>
                )}
              </div>
          </div>
        );
      })}
    </div>
  );
}
