"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { resolveItemStatus, STATE_LABELS } from "@/lib/item-status";
import { etaCountdown } from "@/lib/eta";

// Map the eta countdown semantic band onto the internal T palette.
// Mirrors the portal's color mapping (which uses C) so the urgency
// cue reads identically on both surfaces.
const ETA_BAND_COLORS = {
  red: T.red,
  amber: T.amber,
  muted: T.muted,
  green: T.green,
};

// Job Overview items list — worksheet-style row layout.
// Mirrors the per-item working sheet on /clients/[id]: both EDIT the same
// items.client_eta column, which the client portal + quote/invoice PDFs READ.
// (Production shipping is read-only here — see the "Ship in Production →" link.)
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

export function JobItemsList({ items, job, isMobile, onChange, vendorFilter, onClearVendor }) {
  const supabase = createClient();
  const [localEta, setLocalEta] = useState({});
  const saveTimers = useRef({});
  const pendingSaves = useRef({});
  // Shipping moved to the /production board (Phase 2) — the project page is
  // read-only for production status. Client ETA editing stays (client comms).

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

  // Resolve an item's lifecycle state (used by the row + the group's batch-ship
  // selection, so both agree on what's shippable).
  const stateOf = (item) => {
    const decoratorName = item.decorator || null;
    const decoratorShort = item.decorator_assignments?.[0]?.decorators?.short_code || null;
    const poSent = !!((decoratorName && sentLower.has(decoratorName.toLowerCase())) || (decoratorShort && sentLower.has(decoratorShort.toLowerCase())));
    return resolveItemStatus({
      archived_at: item.archived_at, completed_at: item.completed_at, pipeline_stage: item.pipeline_stage,
      received_at_hpd: item.received_at_hpd, sell_per_unit: item.sell_per_unit, blanks_order_cost: item.blanks_order_cost,
      po_sent: poSent, job_phase: job?.phase, job_shipping_route: job?.shipping_route,
      item_shipping_route: item.shipping_route, job_completed_at: jobCompletedAt,
      forwarded_at: item.forwarded_at || null,
    });
  };

  if (!items || items.length === 0) {
    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Items</div>
        <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>No items yet. Add items in the Buy Sheet tab.</p>
      </div>
    );
  }

  const totalUnits = items.reduce((a, it) => a + tQty(it.qtys || {}), 0);

  // Group by decorator/vendor. When a production vendor chip opened this modal,
  // vendorFilter scopes it to just that vendor; otherwise all vendors show.
  const itemVendor = (it) => it.decorator_assignments?.[0]?.decorators?.name || it.decorator || "Unassigned";
  const shownItems = vendorFilter ? items.filter(it => itemVendor(it) === vendorFilter) : items;
  const vendorGroups = [];
  const groupIndex = {};
  for (const it of shownItems) {
    const v = itemVendor(it);
    if (groupIndex[v] === undefined) { groupIndex[v] = vendorGroups.length; vendorGroups.push([v, []]); }
    vendorGroups[groupIndex[v]][1].push(it);
  }

  // Column template tuned for the four columns. On mobile we drop to
  // a two-row stack so the ETA input keeps a tappable width.
  const cols = isMobile
    ? "minmax(0, 1fr)"
    : "minmax(0, 1fr) 54px 88px 108px 188px";

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Items</span>
          {vendorFilter && (
            <button onClick={() => onClearVendor && onClearVendor()}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 5, border: `1px solid ${T.accent}55`, background: T.accentDim, color: T.accent, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
              {vendorFilter} <span style={{ fontSize: 12, lineHeight: 1 }}>×</span>
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/production" title="Shipping is managed on the Production board" style={{ fontSize: 10, fontWeight: 700, color: T.accent, textDecoration: "none", fontFamily: font, whiteSpace: "nowrap" }}>Ship in Production →</a>
          <span style={{ fontSize: 10, color: T.muted }}>
            {shownItems.length} items · {shownItems.reduce((a, it) => a + tQty(it.qtys || {}), 0).toLocaleString()} units
          </span>
        </div>
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
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ship</div>
        </div>
      )}

      {vendorGroups.length === 0 && (
        <div style={{ fontSize: 12, color: T.muted, padding: "8px 10px" }}>No items{vendorFilter ? ` for ${vendorFilter}` : ""}.</div>
      )}
      {vendorGroups.map(([vendorName, vItems]) => {
        return (
        <div key={vendorName} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 10px 5px" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: T.text }}>{vendorName}</span>
            <span style={{ fontSize: 9.5, color: T.faint, fontFamily: mono }}>{vItems.length} item{vItems.length !== 1 ? "s" : ""} · {vItems.reduce((a, it) => a + tQty(it.qtys || {}), 0).toLocaleString()} units</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {vItems.map(item => {
          const qty = tQty(item.qtys || {});
          const state = stateOf(item);
          const stateLabel = STATE_LABELS[state] || "—";
          const stateColor = ITEM_STATE_COLORS[state] || T.muted;
          const etaValue = localEta[item.id] !== undefined ? localEta[item.id] : (item.client_eta || "");
          // Countdown — only shown while an ETA is actually set. Once
          // an item lands (in_stock / complete / archived / cancelled)
          // the prediction has been satisfied so hide the chip; matches
          // the portal's resolveItemEta gating.
          const showCountdown = !!etaValue && !["in_stock","complete","archived","cancelled"].includes(state);
          const cd = showCountdown ? etaCountdown(etaValue) : null;
          const cdColor = cd ? ETA_BAND_COLORS[cd.band] : T.muted;

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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0" }}>
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
                    {cd && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: cdColor, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                        {cd.text}
                      </span>
                    )}
                  </div>
                </div>
                {state === "shipped" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ship</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ Shipped{item.ship_tracking ? ` · ${item.ship_tracking}` : ""}</span>
                  </div>
                )}
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
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <input type="date"
                  value={etaValue}
                  onChange={e => updateEta(item.id, e.target.value)}
                  onBlur={() => flushEta(item.id)}
                  style={{
                    padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 4,
                    background: T.card, color: T.text, fontSize: 11, fontFamily: mono,
                    outline: "none", width: "100%", boxSizing: "border-box",
                  }} />
                {cd && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: cdColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {cd.text}
                  </span>
                )}
              </div>
              {/* Ship status — read-only. Shipping happens on /production. */}
              <div onClick={e => e.stopPropagation()}>
                {state === "shipped" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>✓ Shipped</span>
                    {item.ship_tracking && <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.ship_tracking}</span>}
                  </div>
                ) : state === "in_production" ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.05em" }}>In production</span>
                ) : (
                  <span style={{ fontSize: 11, color: T.faint }}>—</span>
                )}
              </div>
            </div>
          );
            })}
          </div>
        </div>
        );
      })}

    </div>
  );
}
