"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { resolveItemStatus, STATE_LABELS } from "@/lib/item-status";
import { etaCountdown } from "@/lib/eta";
import { shipItemFromDecorator } from "@/lib/po-actions";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";

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

export function JobItemsList({ items, job, isMobile, onChange, vendorFilter, onClearVendor }) {
  const supabase = createClient();
  const [localEta, setLocalEta] = useState({});
  const saveTimers = useRef({});
  const pendingSaves = useRef({});
  // Ship modal — an array of items (1 = single w/ per-size grid, >1 = batch:
  // shared tracking + notes + packing slip applied to all, like /production).
  const [shipTargets, setShipTargets] = useState(null);
  const [selected, setSelected] = useState(new Set());   // item ids checked for batch
  const [shipQtys, setShipQtys] = useState({});          // per-size, single only
  const [shipTracking, setShipTracking] = useState("");
  const [shipNotes, setShipNotes] = useState("");
  const [shipSlips, setShipSlips] = useState([]);
  const [slipBusy, setSlipBusy] = useState("");
  const [shipBusy, setShipBusy] = useState(false);

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

  // ── Ship modal (single or batch) ──
  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // shipQtys is keyed `${itemId}:${size}` so single + batch share one editable
  // grid per item (matches the /production modal).
  const itemSizes = (item) => sortSizes((item.buy_sheet_lines || []).map(l => l.size));
  const seedQtys = (itemsToShip) => {
    const q = {};
    itemsToShip.forEach(item => {
      const existing = item.ship_qtys || {};
      const lines = item.buy_sheet_lines || [];
      itemSizes(item).forEach(sz => { q[`${item.id}:${sz}`] = String(existing[sz] ?? lines.find(l => l.size === sz)?.qty_ordered ?? 0); });
    });
    return q;
  };
  const qtysForItem = (item) => {
    const q = {};
    itemSizes(item).forEach(sz => { const v = parseInt(shipQtys[`${item.id}:${sz}`]) || 0; if (v > 0) q[sz] = v; });
    return q;
  };
  async function loadSlips(itemId) {
    const { data } = await supabase.from("item_files").select("id, file_name, drive_link").eq("item_id", itemId).eq("stage", "packing_slip");
    setShipSlips(data || []);
  }
  function openShip(item) {
    setShipQtys(seedQtys([item])); setShipTracking(item.ship_tracking || ""); setShipNotes(item.ship_notes || "");
    setShipSlips([]); loadSlips(item.id); setShipTargets([item]);
  }
  function openBatch(itemsToShip) {
    setShipQtys(seedQtys(itemsToShip)); setShipTracking(""); setShipNotes("");
    setShipSlips([]); if (itemsToShip[0]) loadSlips(itemsToShip[0].id); setShipTargets(itemsToShip);
  }
  async function uploadSlips(files) {
    const arr = Array.from(files || []); if (!arr.length || !shipTargets) return;
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      setSlipBusy(`Uploading ${arr.length > 1 ? `${i + 1}/${arr.length} ` : ""}${file.name}…`);
      try {
        const r = await uploadToDrive({ blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream", clientName: job?.clients?.name || job?.client_name || "", projectTitle: job?.title || "", itemName: "Packing Slips" });
        for (const it of shipTargets) {
          await registerFileInDb({ fileId: r.fileId, webViewLink: r.webViewLink, folderLink: r.folderLink, fileName: file.name, mimeType: file.type, fileSize: file.size, itemId: it.id, stage: "packing_slip" });
        }
      } catch (e) { console.error("[job-items-list] slip upload failed:", e); }
    }
    setSlipBusy(""); if (shipTargets[0]) loadSlips(shipTargets[0].id);
  }
  async function removeSlip(file) {
    if (!shipTargets) return;
    await supabase.from("item_files").delete().eq("stage", "packing_slip").eq("file_name", file.file_name).in("item_id", shipTargets.map(i => i.id));
    if (shipTargets[0]) loadSlips(shipTargets[0].id);
  }
  async function confirmShip() {
    if (!shipTargets) return;
    setShipBusy(true);
    try {
      for (const item of shipTargets) {
        const qtys = qtysForItem(item);
        await shipItemFromDecorator(supabase, {
          id: item.id, name: item.name, job_id: job?.id,
          pipeline_timestamps: item.pipeline_timestamps,
          ship_qtys: Object.keys(qtys).length ? qtys : null,
          ship_notes: shipNotes.trim() || null,
          ship_tracking: shipTracking.trim() || null,
          decorator_assignment_id: item.decorator_assignment_id,
          shipping_route: item.shipping_route,
        });
      }
      setShipTargets(null); setSelected(new Set());
      if (onChange) onChange();
    } catch (e) { console.error("[job-items-list] ship failed:", e); }
    setShipBusy(false);
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
        <span style={{ fontSize: 10, color: T.muted }}>
          {shownItems.length} items · {shownItems.reduce((a, it) => a + tQty(it.qtys || {}), 0).toLocaleString()} units
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
          <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ship</div>
        </div>
      )}

      {vendorGroups.length === 0 && (
        <div style={{ fontSize: 12, color: T.muted, padding: "8px 10px" }}>No items{vendorFilter ? ` for ${vendorFilter}` : ""}.</div>
      )}
      {vendorGroups.map(([vendorName, vItems]) => {
        const groupSelected = vItems.filter(it => selected.has(it.id) && stateOf(it) === "in_production");
        return (
        <div key={vendorName} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 10px 5px" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: T.text }}>{vendorName}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {groupSelected.length > 0 && (
                <button onClick={() => openBatch(groupSelected)}
                  style={{ padding: "4px 12px", border: "none", borderRadius: 6, background: T.green, color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Ship {groupSelected.length} selected…
                </button>
              )}
              <span style={{ fontSize: 9.5, color: T.faint, fontFamily: mono }}>{vItems.length} item{vItems.length !== 1 ? "s" : ""} · {vItems.reduce((a, it) => a + tQty(it.qtys || {}), 0).toLocaleString()} units</span>
            </div>
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
                {(state === "in_production" || state === "shipped") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ship</span>
                    {state === "shipped" ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ Shipped{item.ship_tracking ? ` · ${item.ship_tracking}` : ""}</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: T.muted, cursor: "pointer" }}>
                          <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ width: 15, height: 15, accentColor: T.green, cursor: "pointer" }} />
                          Select
                        </label>
                        <button onClick={() => openShip(item)}
                          style={{ padding: "8px 16px", border: "none", borderRadius: 6, background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>Ship…</button>
                      </div>
                    )}
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
              {/* Ship — mark in-production items shipped (+ optional tracking) */}
              <div onClick={e => e.stopPropagation()}>
                {state === "shipped" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>✓ Shipped</span>
                    {item.ship_tracking && <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.ship_tracking}</span>}
                  </div>
                ) : state === "in_production" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} title="Select for batch ship" style={{ width: 14, height: 14, accentColor: T.green, cursor: "pointer", flexShrink: 0 }} />
                    <button onClick={() => openShip(item)}
                      style={{ flex: 1, padding: "6px 10px", border: "none", borderRadius: 4, background: T.green, color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>
                      Ship…
                    </button>
                  </div>
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

      {/* Per-item ship modal — qtys + tracking + notes + packing slip */}
      {shipTargets && (() => {
        const single = shipTargets.length === 1;
        const grandTotal = shipTargets.reduce((a, it) => a + itemSizes(it).reduce((s, sz) => s + (parseInt(shipQtys[`${it.id}:${sz}`]) || 0), 0), 0);
        const fieldInp = { padding: "9px 11px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 14, fontFamily: mono, outline: "none", width: "100%", boxSizing: "border-box" };
        return (
          <div onClick={() => !shipBusy && setShipTargets(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300, display: "flex", alignItems: isMobile ? "flex-end" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "6vh 16px", overflowY: "auto" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: isMobile ? "16px 16px 0 0" : 14, padding: 18, width: "100%", maxWidth: isMobile ? "100%" : 480, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{single ? "Ship item" : `Ship ${shipTargets.length} items`}</div>
                <button onClick={() => setShipTargets(null)} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 13, color: T.muted, marginBottom: 14 }}>{grandTotal.toLocaleString()} total units{single ? ` · ${shipTargets[0].name}` : ""}</div>

              {/* Per-item, per-size editable shipped qtys */}
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 14, overflow: "hidden" }}>
                {shipTargets.map((it, idx) => {
                  const szs = itemSizes(it);
                  const itTotal = szs.reduce((a, sz) => a + (parseInt(shipQtys[`${it.id}:${sz}`]) || 0), 0);
                  return (
                    <div key={it.id} style={{ padding: "10px 12px", borderTop: idx ? `1px solid ${T.border}55` : "none" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
                        <span style={{ fontFamily: mono, color: T.muted, fontSize: 12 }}>{itTotal.toLocaleString()} units</span>
                      </div>
                      {szs.length === 0 ? (
                        <div style={{ fontSize: 11, color: T.faint }}>No size breakdown.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {szs.map(sz => (
                            <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, color: T.muted }}>{sz}</span>
                              <input value={shipQtys[`${it.id}:${sz}`] ?? ""} inputMode="numeric" onFocus={e => e.target.select()}
                                onChange={e => setShipQtys(p => ({ ...p, [`${it.id}:${sz}`]: e.target.value }))}
                                style={{ ...fieldInp, width: 52, textAlign: "center", padding: "8px 4px", fontWeight: 600 }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Tracking #</span>
                <input value={shipTracking} onChange={e => setShipTracking(e.target.value)} placeholder="Optional" style={fieldInp} />
              </label>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Notes</span>
                <input value={shipNotes} onChange={e => setShipNotes(e.target.value)} placeholder="Optional" style={{ ...fieldInp, fontFamily: font }} />
              </label>

              {/* Packing slip */}
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Packing slip</div>
              {shipSlips.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12 }}>
                  <a href={f.drive_link} target="_blank" rel="noreferrer" style={{ flex: 1, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
                  <button onClick={() => removeSlip(f)} style={{ background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer" }}>×</button>
                </div>
              ))}
              <label style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, border: `1px dashed ${T.border}`, color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font, marginTop: 4 }}>
                + Add packing slip
                <input type="file" multiple accept="image/*,application/pdf" style={{ display: "none" }}
                  onChange={e => { uploadSlips(e.target.files); e.target.value = ""; }} />
              </label>
              {slipBusy && <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>{slipBusy}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
                <button onClick={() => setShipTargets(null)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
                <button onClick={confirmShip} disabled={shipBusy || !!slipBusy}
                  style={{ background: T.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 700, fontFamily: font, cursor: (shipBusy || slipBusy) ? "default" : "pointer", opacity: (shipBusy || slipBusy) ? 0.6 : 1 }}>
                  {shipBusy ? "Shipping…" : single ? "Mark shipped" : `Ship ${shipTargets.length} items`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
