"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { resolveItemStatus, STATE_LABELS } from "@/lib/item-status";

// Job Overview items list — worksheet-style row layout.
// Mirrors the per-item working sheet on /clients/[id] so ETA edits
// here auto-sync there (and to ProductionTab + /production page).
// All four surfaces edit the same items.client_eta column.
//
// Columns: name (+ vendor / sku) · qty · status · ETA
// Status: canonical resolveItemStatus from lib/item-status.
// ETA edit: debounced save (600ms) + flush on blur to prevent loss.

const ITEM_STATE_COLORS = {
  setup: T.muted,
  in_production: T.accent,
  shipped: T.purple,
  in_stock: "#14b8a6",
  complete: T.green,
  archived: T.faint,
  on_hold: T.amber,
  cancelled: T.red,
};

const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);

export function JobItemsList({ items, job, isMobile, onChange }) {
  const supabase = createClient();
  const [localEta, setLocalEta] = useState({});
  const saveTimers = useRef({});
  const pendingSaves = useRef({});

  // Seed local ETA state for any new item. Existing entries are
  // preserved so an in-flight edit doesn't get clobbered by a parent
  // re-render that re-passes items.
  useEffect(() => {
    setLocalEta(prev => {
      const next = { ...prev };
      let changed = false;
      items.forEach(it => {
        if (next[it.id] === undefined) {
          next[it.id] = it.client_eta || "";
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

  // Flush pending saves on unmount so a quick edit + tab switch
  // doesn't drop the write.
  useEffect(() => {
    return () => {
      Object.values(pendingSaves.current).forEach(fn => { if (typeof fn === "function") fn(); });
    };
  }, []);

  async function persistEta(itemId, value) {
    const dbValue = value || null;
    const payload = {
      client_eta: dbValue,
      client_eta_set_at: dbValue ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("items").update(payload).eq("id", itemId);
    if (error) {
      console.error(`[job-items-list] failed to save client_eta on item ${itemId}:`, error);
    }
    if (onChange) onChange();
  }

  function updateEta(itemId, value) {
    setLocalEta(p => ({ ...p, [itemId]: value }));
    const key = itemId + "_client_eta";
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    const doSave = async () => {
      delete pendingSaves.current[key];
      delete saveTimers.current[key];
      await persistEta(itemId, value);
    };
    pendingSaves.current[key] = doSave;
    saveTimers.current[key] = setTimeout(doSave, 600);
  }

  function flushEta(itemId) {
    const key = itemId + "_client_eta";
    if (saveTimers.current[key]) {
      clearTimeout(saveTimers.current[key]);
      delete saveTimers.current[key];
    }
    const fn = pendingSaves.current[key];
    if (typeof fn === "function") return fn();
  }

  // Resolve the same po_sent signal the worksheet uses, so an item
  // whose decorator has had a PO sent shows In Production here even
  // if pipeline_stage hasn't been updated yet.
  const typeMeta = job?.type_meta || {};
  const sentRaw = Array.isArray(typeMeta.po_sent_vendors) ? typeMeta.po_sent_vendors : [];
  const sentLower = new Set(sentRaw.map(s => (s || "").toLowerCase().trim()).filter(Boolean));
  const jobCompletedAt = (job?.phase_timestamps || {}).complete || null;

  if (!items || items.length === 0) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Items</div>
        <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>No items yet. Add items in the Buy Sheet tab.</p>
      </div>
    );
  }

  const totalUnits = items.reduce((a, it) => a + tQty(it.qtys || {}), 0);

  // Column template tuned for the four columns. On mobile we drop to
  // a two-row stack so the ETA input keeps a tappable width.
  const cols = isMobile
    ? "minmax(0, 1fr)"
    : "minmax(0, 1fr) 70px 100px 140px";

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Items</div>
        <span style={{ fontSize: 10, color: T.muted }}>
          {items.length} items · {totalUnits.toLocaleString()} units
        </span>
      </div>

      {/* Column headers — desktop only. Same vocab as worksheet. */}
      {!isMobile && (
        <div style={{
          display: "grid", gridTemplateColumns: cols, gap: 10,
          padding: "0 10px 6px", borderBottom: `1px solid ${T.border}`, marginBottom: 6,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Item</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Qty</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>ETA</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(item => {
          const qty = tQty(item.qtys || {});
          const decoratorName = item.decorator || null;
          const decoratorShort = item.decorator_assignments?.[0]?.decorators?.short_code || null;
          const poSent = !!(
            (decoratorName && sentLower.has(decoratorName.toLowerCase())) ||
            (decoratorShort && sentLower.has(decoratorShort.toLowerCase()))
          );
          const state = resolveItemStatus({
            archived_at: item.archived_at,
            completed_at: item.completed_at,
            pipeline_stage: item.pipeline_stage,
            received_at_hpd: item.received_at_hpd,
            sell_per_unit: item.sell_per_unit,
            blanks_order_cost: item.blanks_order_cost,
            po_sent: poSent,
            job_phase: job?.phase,
            job_shipping_route: job?.shipping_route,
            item_shipping_route: item.shipping_route,
            job_completed_at: jobCompletedAt,
          });
          const stateLabel = STATE_LABELS[state] || "—";
          const stateColor = ITEM_STATE_COLORS[state] || T.muted;
          const etaValue = localEta[item.id] !== undefined ? localEta[item.id] : (item.client_eta || "");

          if (isMobile) {
            // Mobile card: vertical stack — name + meta on top, then a
            // labeled qty / status / ETA row at the bottom. The bare
            // date input got replaced with a label-above-input pattern
            // so it reads as "set the client ETA" instead of an
            // unlabeled date floating in the corner.
            return (
              <div key={item.id} style={{
                display: "flex", flexDirection: "column", gap: 10,
                padding: "12px 14px", background: T.surface, borderRadius: 8,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.25, wordBreak: "break-word" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, color: T.text }}>
                    {qty > 0 ? `${qty.toLocaleString()} units` : "—"}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: stateColor,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>{stateLabel}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Client ETA
                  </span>
                  <input type="date"
                    value={etaValue}
                    onChange={e => updateEta(item.id, e.target.value)}
                    onBlur={() => flushEta(item.id)}
                    style={{
                      padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6,
                      background: T.card, color: T.text, fontSize: 13, fontFamily: mono,
                      outline: "none", minHeight: 36, flex: "1 1 0",
                      display: "block", WebkitAppearance: "none",
                      MozAppearance: "none", appearance: "none",
                    }} />
                </div>
              </div>
            );
          }

          return (
            <div key={item.id} style={{
              display: "grid", gridTemplateColumns: cols, gap: 10,
              padding: "8px 10px", background: T.surface, borderRadius: 6, alignItems: "center",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" ") || "—"}
                </div>
              </div>
              <div style={{ fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>
                {qty > 0 ? qty.toLocaleString() : "—"}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: stateColor,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{stateLabel}</div>
              <input type="date"
                value={etaValue}
                onChange={e => updateEta(item.id, e.target.value)}
                onBlur={() => flushEta(item.id)}
                style={{
                  padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 4,
                  background: T.card, color: T.text, fontSize: 11, fontFamily: mono,
                  outline: "none", width: "100%", boxSizing: "border-box",
                }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
