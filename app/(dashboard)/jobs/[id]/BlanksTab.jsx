"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";
import { useIsMobile } from "@/lib/useIsMobile";
import SizeGrid from "@/components/SizeGrid";
import { parseSizeMatrix } from "@/lib/size-grid";
import { ItemThumb } from "@/components/board-kit";
import { needsProof, allProofsSatisfied, proofCounts } from "@/lib/proof-gate";

// Dark-app palette for the shared <SizeGrid/> cut-ticket renderer.
const GRID_PALETTE = { text: T.text, muted: T.muted, faint: T.faint, border: T.border, surface: T.surface, accent: T.accent };

const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);
// Calculated blank cost = precise per-size sum (blank_costs[sz] × qty[sz]) — the
// SAME source Project Totals uses — not the cent-rounded cost_per_unit average,
// which drifts from the per-size total (e.g. 8.0362 rounds to 8.04 → $57 off on
// 15k units). Falls back to cost_per_unit × units when there are no per-size costs.
const blankCalcCost = (item) => {
  const bc = item.blank_costs || {};
  if (Object.keys(bc).length > 0) {
    return Math.round(Object.entries(bc).reduce((a, [sz, c]) => a + (Number(c) || 0) * (Number(item.qtys?.[sz]) || 0), 0) * 100) / 100;
  }
  return item.cost_per_unit != null ? Math.round(item.cost_per_unit * tQty(item.qtys || {}) * 100) / 100 : null;
};
const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

// Items that aren't actual garment blanks. Matches lib/pricing.ts NON_GARMENT.
// Any of these are priced via custom-cost lines (PO Total) only — they must
// be excluded from the Blanks tab entirely.
const NON_GARMENT = new Set([
  "accessory","patch","sticker","poster","pin","koozie","banner","flag",
  "lighter","towel","water_bottle","samples","custom","key_chain",
  "woven_labels","bandana","socks","tote","custom_bag","pillow","rug",
  "pens","napkins","balloons","stencils",
]);

export function BlanksTab({ items: allItems, job, payments, onRecalcPhase, onUpdateItem, onTabClick, onRegisterSave, onItemsChanged, selectedItemId }) {
  const isMobile = useIsMobile();
  const items = useMemo(() => allItems.filter(it => !NON_GARMENT.has(it.garment_type)), [allItems]);

  // Mockup thumbnails for the V2 row layout — one drive_file_id per item.
  const [mockupIds, setMockupIds] = useState({});
  useEffect(() => {
    const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (!ids.length) return;
    createClient().from("item_files").select("item_id, drive_file_id, stage, file_name")
      .in("item_id", ids).is("superseded_at", null)
      .then(({ data }) => {
        const m = {};
        for (const f of (data || [])) {
          if ((f.stage === "mockup" || f.file_name?.toLowerCase().includes("mockup")) && !m[f.item_id]) m[f.item_id] = f.drive_file_id;
        }
        setMockupIds(m);
      });
  }, [items]);
  // Letter designators are canonical across surfaces (ProductBuilder,
  // PO, Blanks) — they must reflect the item's position in the FULL
  // sort_order-ordered list, not its position in the filtered apparel
  // subset. Without this map, an item at position E in ProductBuilder
  // would show as A in Blanks if patches/flags filtered out ahead of it.
  const letterByItemId = useMemo(() => {
    const sorted = [...allItems].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const map = {};
    sorted.forEach((it, idx) => { map[it.id] = String.fromCharCode(65 + idx); });
    return map;
  }, [allItems]);
  const supabase = createClient();
  const [localFields, setLocalFields] = useState({});
  const [proofStatus, setProofStatus] = useState({});
  // Multi-select state — checked items across the list. When ≥1 is
  // selected an action bar appears with a single "Apply order" input
  // that allocates one total across the selection proportionally by
  // each item's calculated cost.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkApply, setShowBulkApply] = useState(false);
  const [bulkTotal, setBulkTotal] = useState("");
  const saveTimers = useRef({});
  const pendingSaves = useRef({});

  // Flush every pending debounced save in parallel. Resolves once all
  // Supabase writes complete + onUpdateItem has propagated, so the
  // parent has fresh values before a tab switch unmounts us. Also
  // cancels outstanding setTimeout schedules so they don't double-fire.
  const flushAll = async () => {
    const fns = Object.values(pendingSaves.current).filter(fn => typeof fn === "function");
    pendingSaves.current = {};
    Object.values(saveTimers.current).forEach(t => clearTimeout(t));
    saveTimers.current = {};
    if (fns.length === 0) return;
    await Promise.all(fns.map(fn => Promise.resolve().then(fn)));
  };

  // Register flush with parent so switchTab awaits it before unmount.
  // Mirrors the BuySheet / Costing tab pattern — without this, a fast
  // tab switch can unmount before the 800ms debounce fires, the save
  // runs orphaned in the background, and the remount reads stale items.
  useEffect(() => {
    if (typeof onRegisterSave === "function") onRegisterSave(flushAll);
    return () => {
      // Best-effort flush on unmount in case the parent didn't await us
      // (e.g. browser navigation, hard reload). Fire-and-forget; the
      // explicit onRegisterSave path is the one switchTab waits on.
      flushAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterSave]);

  // Load proof status
  useEffect(() => {
    if (!items.length) return;
    const ids = items.map(it => it.id);
    supabase.from("item_files").select("item_id, stage, approval").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
      const status = {};
      for (const it of items) {
        const proofs = (data || []).filter(f => f.item_id === it.id && f.stage === "proof");
        const manualApproved = !needsProof(it) || it.artwork_status === "approved";
        status[it.id] = {
          hasProof: proofs.length > 0 || manualApproved,
          allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")),
        };
      }
      setProofStatus(status);
    });
  }, [items]);

  // Sync local fields from items prop. Initializes on mount, AND
  // pulls fresh values when the prop changes (e.g. after bulk apply,
  // page-level reloadItems, or a tab-switch remount). Without the
  // "or local-is-empty-but-prop-has-value" path, a remount could see
  // localFields populated from a prior tick but missing the latest
  // saved value, and the UI would display blank.
  useEffect(() => {
    setLocalFields(prev => {
      const next = { ...prev };
      let changed = false;
      items.forEach(it => {
        const cur = next[it.id];
        const localCostEmpty = !cur || cur.blanks_order_cost === "" || cur.blanks_order_cost == null;
        const localNumEmpty = !cur || cur.blanks_order_number === "" || cur.blanks_order_number == null;
        const propCost = it.blanks_order_cost;
        const propNum = it.blanks_order_number;
        const needsCost = localCostEmpty && propCost != null && propCost !== "";
        const needsNum = localNumEmpty && propNum != null && propNum !== "";
        if (!cur) {
          next[it.id] = {
            blanks_order_number: propNum || "",
            blanks_order_cost: propCost == null ? "" : propCost,
          };
          changed = true;
        } else if (needsCost || needsNum) {
          next[it.id] = {
            blanks_order_number: needsNum ? propNum : cur.blanks_order_number,
            blanks_order_cost: needsCost ? propCost : cur.blanks_order_cost,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

  function updateField(itemId, field, value) {
    setLocalFields(p => ({ ...p, [itemId]: { ...p[itemId], [field]: value } }));
    const key = itemId + "_" + field;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    const doSave = async () => {
      delete pendingSaves.current[key];
      // Empty input → null (not ordered). An explicit "0" → 0 (ordered, free —
      // e.g. client-supplied or already-owned blanks). null vs 0 is the
      // ordered/not-ordered signal everywhere; never coerce 0 to null.
      const parseCost = (value) => {
        const s = String(value).replace(/[^0-9.\-]/g, "");
        if (s === "") return null;
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
      };
      const dbVal = field === "blanks_order_cost" ? parseCost(value) : (value || null);
      await supabase.from("items").update({ [field]: dbVal }).eq("id", itemId);
      if (onUpdateItem) onUpdateItem(itemId, { [field]: dbVal });
      if (field === "blanks_order_cost" && dbVal != null) {
        const item = items.find(it => it.id === itemId);
        if (item) {
          const supplier = item.blank_vendor || "blank vendor";
          logJobActivity(job.id, `Blanks ordered for ${item.name} — ${supplier} · $${Number(dbVal).toFixed(2)}`);
        }
      }
      if (onRecalcPhase) onRecalcPhase();
    };
    pendingSaves.current[key] = doSave;
    saveTimers.current[key] = setTimeout(doSave, 800);
  }

  function toggleSelected(itemId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setShowBulkApply(false);
    setBulkTotal("");
  }

  // Apply a single order total across the currently selected items.
  // Allocation rule: proportional by each item's calculated cost
  // (cost_per_unit × total qty). Items missing calc cost fall back to
  // equal split among themselves. Each item gets its share saved to
  // items.blanks_order_cost, marking it as purchased on the variance
  // check downstream. Activity log entry per item, plus a roll-up
  // entry on the parent job so the order is traceable.
  async function applyBulkOrder() {
    const total = parseFloat(String(bulkTotal).replace(/[^0-9.\-]/g, ""));
    // Allow exactly 0 (mark free/zero-cost blanks as ordered); reject only
    // empty/invalid/negative input.
    if (bulkTotal === "" || isNaN(total) || total < 0) return;
    const targets = items.filter(it => selectedIds.has(it.id));
    if (targets.length === 0) return;

    // Compute per-item calc cost; null means no qty × cost data on file.
    const calcs = targets.map(it => {
      const qty = tQty(it.qtys || {});
      const cpu = it.cost_per_unit;
      return cpu != null && qty > 0 ? cpu * qty : null;
    });
    const calcSum = calcs.reduce((a, v) => a + (v || 0), 0);
    const allKnown = calcs.every(v => v != null && v > 0);

    // Shares (allocated cents) — round to cents per item, fix the last
    // item to absorb rounding drift so the row sum matches the total
    // entered exactly.
    const cents = Math.round(total * 100);
    const shares = targets.map((_, i) => {
      if (allKnown && calcSum > 0) {
        return Math.round((calcs[i] / calcSum) * cents);
      }
      // Equal split fallback (some items missing calc)
      return Math.round(cents / targets.length);
    });
    const drift = cents - shares.reduce((a, v) => a + v, 0);
    shares[shares.length - 1] += drift;

    // Apply local + DB updates in parallel. Each item gets its own
    // setLocalFields, supabase.update, and onUpdateItem call. We
    // await all writes via Promise.all so we know the DB is committed
    // before clearing selection — fixes the case where a mid-loop
    // unmount could leave some items unsaved.
    const itemSummaries = [];
    const writes = targets.map(async (it, i) => {
      const dollars = shares[i] / 100;
      setLocalFields(p => ({ ...p, [it.id]: { ...p[it.id], blanks_order_cost: dollars.toFixed(2) } }));
      const { error } = await supabase.from("items").update({ blanks_order_cost: dollars }).eq("id", it.id);
      if (error) {
        console.error("[blanks bulk] update failed for", it.name, error);
        return { it, dollars, ok: false };
      }
      if (onUpdateItem) onUpdateItem(it.id, { blanks_order_cost: dollars });
      itemSummaries.push(`${letterByItemId[it.id] || ""} ${it.name} · $${dollars.toFixed(2)}`);
      return { it, dollars, ok: true };
    });
    await Promise.all(writes);

    try {
      logJobActivity(job.id, `Bulk blanks order: $${total.toFixed(2)} across ${targets.length} item${targets.length !== 1 ? "s" : ""} — ${itemSummaries.join(", ")}`);
    } catch {}

    if (onRecalcPhase) onRecalcPhase();
    // Force the parent to re-fetch items from the DB so any subscriber
    // (PO tab's blanks-pending check, lifecycle gates, etc.) sees the
    // new values immediately. Belt-and-suspenders alongside onUpdateItem.
    if (onItemsChanged) {
      try { await onItemsChanged(); } catch {}
    }
    clearSelection();
  }


  // Gate checks
  const quoteApproved = job?.quote_approved;
  const terms = job?.payment_terms || "";
  const isNetTerms = terms === "net_15" || terms === "net_30";

  let paymentGateMet = false;
  if (isNetTerms) {
    paymentGateMet = true;
  } else if (terms === "prepaid") {
    paymentGateMet = (payments || []).filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0) > 0;
  } else if (terms === "deposit_balance") {
    paymentGateMet = (payments || []).some(p => p.status === "paid" || p.status === "partial");
  } else {
    paymentGateMet = false; // Require terms to be set
  }

  const allProofsApproved = allProofsSatisfied(items, proofStatus);
  const proofC = proofCounts(items, proofStatus);
  const gatesMet = quoteApproved && paymentGateMet && allProofsApproved;

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No apparel items — continue to PO.</div>;
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 12, paddingBottom: selectedIds.size > 0 ? 88 : 0 }}>

      {/* ── Gate strip ── */}
      {!gatesMet ? (
        <div style={{ ...card, padding: "11px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Before ordering blanks</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: quoteApproved ? T.green : T.red, fontWeight: 800 }}>{quoteApproved ? "✓" : "✕"}</span>
              <span style={{ color: quoteApproved ? T.muted : T.text }}>Quote approved</span>
            </div>
            {!isNetTerms ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ color: paymentGateMet ? T.green : T.red, fontWeight: 800 }}>{paymentGateMet ? "✓" : "✕"}</span>
                <span style={{ color: paymentGateMet ? T.muted : T.text }}>
                  {terms === "prepaid" ? "Full payment received" : "Deposit received"}
                  {!paymentGateMet && <> (add on <a onClick={e=>{e.preventDefault();if(onTabClick)onTabClick("invoice");}} style={{color:T.accent,cursor:"pointer",textDecoration:"underline"}}>Invoice</a> tab)</>}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ color: T.green, fontWeight: 800 }}>✓</span>
                <span style={{ color: T.muted }}>Net terms — payment on account, no gate</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: allProofsApproved ? T.green : T.red, fontWeight: 800 }}>{allProofsApproved ? "✓" : "✕"}</span>
              <span style={{ color: allProofsApproved ? T.muted : T.text }}>All proofs approved ({proofC.approved}/{proofC.total}{proofC.noProof ? ` · ${proofC.noProof} no proof` : ""})</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: "11px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: T.green, fontWeight: 800, fontSize: 13 }}>✓</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>All gates met · ready to order blanks</span>
        </div>
      )}

      {/* ── Variance KPIs ── */}
      {(() => {
        let totalCalc = 0, totalActual = 0, hasAny = false;
        items.forEach(item => {
          const fld = localFields[item.id] || {};
          const calcCost = blankCalcCost(item) || 0;
          const actualCost = fld.blanks_order_cost ? parseFloat(String(fld.blanks_order_cost).replace(/[^0-9.\-]/g, "")) : 0;
          totalCalc += calcCost; totalActual += actualCost;
          if (actualCost > 0) hasAny = true;
        });
        if (!hasAny) return null;
        const variance = totalActual - totalCalc;
        const vColor = variance === 0 ? T.faint : variance > 0 ? T.red : T.green;
        const tile = (k, v, c) => (
          <div style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontFamily: mono, color: c || T.text }}>{v}</div>
          </div>
        );
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {tile("Calculated", "$" + totalCalc.toFixed(2))}
            {tile("Actual ordered", "$" + totalActual.toFixed(2))}
            {tile("Variance", (variance >= 0 ? "+" : "−") + "$" + Math.abs(variance).toFixed(2), vColor)}
          </div>
        );
      })()}


      {/* ── Supplier-grouped item list (production2 row style) ── */}
      {(() => {
        const renderRow = (item) => {
          const fld = localFields[item.id] || {};
          const totalUnits = tQty(item.qtys || {});
          const calcCost = blankCalcCost(item);
          const effectiveOrderCost = (fld.blanks_order_cost != null && fld.blanks_order_cost !== "")
            ? fld.blanks_order_cost
            : (item.blanks_order_cost != null ? item.blanks_order_cost : "");
          const orderEntered = effectiveOrderCost !== "" && effectiveOrderCost != null;
          const actualCost = orderEntered ? (parseFloat(String(effectiveOrderCost).replace(/[^0-9.\-]/g, "")) || 0) : null;
          const costDiff = calcCost !== null && actualCost !== null ? actualCost - calcCost : null;
          const letter = letterByItemId[item.id] || "";
          const sel = selectedIds.has(item.id);
          const colorVal = item.color || item.blank_color || "";
          const sizeStr = (item.sizes || []).filter(sz => (item.qtys || {})[sz] > 0).map(sz => sz + ":" + (item.qtys || {})[sz]).join(" ");
          const sub = [item.blank_sku, colorVal].filter(Boolean).join(" · ");
          const subs = item.sizeSubs || item.size_subs || {};
          const subSizes = sortSizes((item.sizes || []).filter(sz => { const s = subs[sz]; return s && (s.label || s.color || s.note) && (item.qtys?.[sz] || 0) > 0; }));
          return (
            <div key={item.id} onClick={() => toggleSelected(item.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: `1px solid ${T.border}`, background: sel ? "#fafafb" : "transparent", boxShadow: sel ? `inset 3px 0 0 0 ${T.accent}` : "none", cursor: "pointer" }}>
              <input type="checkbox" checked={sel} readOnly style={{ width: 16, height: 16, accentColor: T.accent, flexShrink: 0, pointerEvents: "none" }} />
              <span style={{ width: 16, textAlign: "center", color: T.muted, fontWeight: 700, fontSize: 12, fontFamily: mono, flexShrink: 0 }}>{letter}</span>
              <span onClick={e => e.stopPropagation()} style={{ display: "flex", flexShrink: 0 }}><ItemThumb fileId={mockupIds[item.id] || null} name={item.name} size={44} /></span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sub && <span>{sub}{"  ·  "}</span>}
                  <span style={{ fontFamily: mono }}>{sizeStr}</span>
                </span>
                <span style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
                {subSizes.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.04em" }}>⚠ Substitute blank on {subSizes.join(", ")}</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 56, flexShrink: 0 }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>Calc</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: mono, color: T.muted }}>{calcCost !== null ? "$" + calcCost.toFixed(2) : "—"}</span>
              </div>
              <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 3, background: T.card, border: `1px solid ${orderEntered ? T.accent : T.border}`, borderRadius: 7, padding: "6px 9px", minWidth: 108, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>$</span>
                <input type="text" inputMode="decimal" value={effectiveOrderCost || ""} placeholder="0.00"
                  onChange={e => updateField(item.id, "blanks_order_cost", e.target.value)} onFocus={e => e.target.select()}
                  style={{ width: 66, border: "none", outline: "none", background: "transparent", textAlign: "right", fontFamily: mono, fontWeight: 700, fontSize: 13, color: T.text }} />
              </div>
              <div style={{ minWidth: 62, textAlign: "right", fontFamily: mono, fontSize: 12, fontWeight: 700, flexShrink: 0, color: costDiff == null ? T.faint : costDiff > 0 ? T.red : costDiff < 0 ? T.green : T.faint }}>
                {costDiff == null ? "—" : costDiff === 0 ? "$0.00" : (costDiff > 0 ? "+" : "−") + "$" + Math.abs(costDiff).toFixed(2)}
              </div>
            </div>
          );
        };
        const groups = new Map();
        for (const it of items) {
          if (selectedItemId && it.id !== selectedItemId) continue;
          const v = it.blank_vendor || "Other supplier";
          if (!groups.has(v)) groups.set(v, []);
          groups.get(v).push(it);
        }
        const poNum = job?.type_meta?.qb_invoice_number;
        return [...groups.entries()].map(([vendor, gitems]) => {
          const units = gitems.reduce((a, it) => a + tQty(it.qtys || {}), 0);
          const isSS = /^S&S/i.test(vendor);
          return (
            <div key={vendor} style={{ ...card }}>
              <div style={{ padding: "9px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{vendor}</span>
                  <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>{gitems.length} item{gitems.length !== 1 ? "s" : ""} · {units.toLocaleString()} units</span>
                </div>
                <span style={{ fontSize: 11.5, color: T.faint, fontFamily: mono }}>{poNum ? "PO #" + poNum : (isSS ? "PO #" + (job?.job_number || "") : "manual order")}</span>
              </div>
              {gitems.map(renderRow)}
            </div>
          );
        });
      })()}

      {/* ── Summary ── */}
      <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>
        {items.filter(it => { const lv = localFields[it.id]?.blanks_order_cost; const v = lv !== undefined ? lv : it.blanks_order_cost; return v !== "" && v != null; }).length}/{items.length} items ordered
      </div>

      {/* ── Sticky bulk-apply bar ── */}
      {selectedIds.size > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: T.card, borderTop: `1px solid ${T.border}`, boxShadow: "0 -4px 20px rgba(0,0,0,0.06)", padding: "14px 24px", zIndex: 40 }}>
          <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.accent }}>{selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected</span>
            <button onClick={clearSelection} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, color: T.muted, cursor: "pointer", fontFamily: font }}>Clear</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: T.muted }}>One PO total, split by calc:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 3, background: T.card, border: `1px solid ${T.accent}`, borderRadius: 8, padding: "7px 10px" }}>
              <span style={{ fontSize: 13, color: T.faint, fontFamily: mono }}>$</span>
              <input type="text" inputMode="decimal" placeholder="0.00" value={bulkTotal}
                onChange={e => setBulkTotal(e.target.value)} onFocus={e => e.target.select()}
                onKeyDown={e => { if (e.key === "Enter") applyBulkOrder(); }}
                style={{ width: 100, border: "none", outline: "none", background: "transparent", textAlign: "right", fontFamily: mono, fontWeight: 700, fontSize: 14, color: T.text }} />
            </div>
            {(() => { const n = parseFloat(String(bulkTotal).replace(/[^0-9.\-]/g, "")); const invalid = bulkTotal === "" || isNaN(n) || n < 0;
              return <button onClick={applyBulkOrder} disabled={invalid} style={{ background: invalid ? T.accentDim : T.green, color: invalid ? T.faint : "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: invalid ? "default" : "pointer", fontFamily: font }}>Apply to {selectedIds.size} →</button>;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
