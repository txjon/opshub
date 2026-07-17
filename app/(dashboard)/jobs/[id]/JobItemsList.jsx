"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { resolveItemStatus, STATE_LABELS } from "@/lib/item-status";
import { shipProgress } from "@/lib/ship-progress";
import { etaCountdown } from "@/lib/eta";
import { fmtDay } from "@/lib/dates";
import LedgerHistory from "@/components/LedgerHistory";
import { TrackingLink } from "@/components/TrackingModal";

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
// (Production shipping is read-only here — see the "Ship in Production →" link.)
//
// Columns: name (+ vendor / sku) · qty · status · ETA
// Status: canonical resolveItemStatus from lib/item-status.
// ETA: READ-ONLY chain-resolved chip (/api/item-etas) since 2026-07-15 — the
// same value the Client Hub shows. ✎ marks a manual client_eta override.

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
  // Chain-resolved ETAs (read-only, locked 2026-07-15): dates are SET at the
  // workflow surfaces — PO tab ship-by, production2 slip edits, receiving2
  // arrival edits — and this chip just reads the resolved result (same value
  // the Client Hub shows). { [itemId]: { eta, source } }
  const [chainEtas, setChainEtas] = useState({});
  useEffect(() => {
    if (!job?.id) return;
    let dead = false;
    fetch(`/api/item-etas?jobId=${job.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!dead && d?.etas) setChainEtas(d.etas); })
      .catch(() => {});
    return () => { dead = true; };
  }, [job?.id, items]);
  // Per-item inventory history (the movement ledger — what actually shipped /
  // received / forwarded / entered by size, permanent). Reachable for every item
  // on every job, including complete ones.
  const [historyFor, setHistoryFor] = useState(null);
  const histBtn = (item) => (
    <button
      onClick={(e) => { e.stopPropagation(); setHistoryFor({ itemId: item.id, itemName: item.name || "Item" }); }}
      title="Inventory history — what shipped / received / forwarded, by size"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, flexShrink: 0, border: `1px solid ${T.border}`, background: T.card, color: T.muted, cursor: "pointer", borderRadius: 5 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>
    </button>
  );
  // ETA writes were removed from this surface (read-only chip since
  // 2026-07-15) — client_eta overrides, when needed, are set via the
  // worksheet-era paths that remain in /production; day-to-day dates flow
  // from the chain automatically.

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
          <a href="/production2" title="Shipping is managed on the Production board" style={{ fontSize: 10, fontWeight: 700, color: T.accent, textDecoration: "none", fontFamily: font, whiteSpace: "nowrap" }}>Ship in Production →</a>
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
          const chainEta = chainEtas[item.id] || {};
          const etaValue = chainEta.eta || "";
          const etaIsOverride = chainEta.source === "override";
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
                <div style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.25, wordBreak: "break-word" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {histBtn(item)}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0", justifyContent: "flex-end" }}
                    title="Read-only — flows from the date chain (PO ship-by · production slips · receiving arrivals)">
                    {["in_stock", "complete"].includes(state) ? (
                      <span style={{ fontSize: 11, color: T.faint, fontWeight: 600 }}>arrived</span>
                    ) : (<>
                      <span style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: etaValue ? T.text : T.faint }}>
                        {etaValue ? fmtDay(etaValue) : "TBD"}{etaIsOverride ? " ✎" : ""}
                      </span>
                      {cd && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: cdColor, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                          {cd.text}
                        </span>
                      )}
                    </>)}
                  </div>
                </div>
                {state === "shipped" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ship</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ Shipped{item.ship_tracking ? <> · <TrackingLink tracking={item.ship_tracking} style={{ fontWeight: 700 }} /></> : ""}</span>
                  </div>
                )}
                {["in_stock", "complete"].includes(state) && item.received_at_hpd && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ship</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ Received</span>
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
              <div style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" ") || "—"}
                  </div>
                </div>
                {histBtn(item)}
              </div>
              <div style={{ fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>
                {qty > 0 ? qty.toLocaleString() : "—"}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: stateColor,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{stateLabel}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}
                title="Read-only — flows from the date chain (PO ship-by · production slips · receiving arrivals)">
                {/* Landed items (in stock / complete) — the prediction is
                    satisfied; a stale date reads as a live ETA, so say so. */}
                {["in_stock", "complete"].includes(state) ? (
                  <span style={{ fontSize: 10, color: T.faint, fontWeight: 600 }}>arrived</span>
                ) : (<>
                  <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: etaValue ? T.text : T.faint }}>
                    {etaValue ? fmtDay(etaValue) : "TBD"}{etaIsOverride ? " ✎" : ""}
                  </span>
                  {cd && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: cdColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {cd.text}
                    </span>
                  )}
                </>)}
              </div>
              {/* Ship status — read-only ship-LEG progress; never restates the
                  Status column. Shipping happens on /production. */}
              <div onClick={e => e.stopPropagation()}>
                {state === "shipped" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>✓ Shipped</span>
                    {item.ship_tracking && <span style={{ fontSize: 9, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><TrackingLink tracking={item.ship_tracking} /></span>}
                  </div>
                ) : ["in_stock", "complete"].includes(state) && item.received_at_hpd ? (
                  // the ship leg finished — furthest milestone wins ("—" here
                  // made the one DONE item look like the least-progressed one)
                  <span style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>✓ Received</span>
                ) : state === "in_production" ? (
                  (() => {
                    // Wave progress when partially shipped; zero progress is a
                    // quiet dash (the Status column already says in production).
                    const p = shipProgress(item.qtys, item.ship_qtys);
                    if (p.shipped > 0 && p.remaining > 0) {
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.05em" }}>Partial · {p.shipped}/{p.ordered}</span>
                          <span style={{ fontSize: 9, color: T.faint }}>{p.remaining} to ship</span>
                        </div>
                      );
                    }
                    return <span style={{ fontSize: 11, color: T.faint }}>—</span>;
                  })()
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

      {historyFor && (
        <LedgerHistory itemId={historyFor.itemId} itemName={historyFor.itemName} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}
