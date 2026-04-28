"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";

const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);
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

export function BlanksTab({ items: allItems, job, payments, onRecalcPhase, onUpdateItem, onTabClick, selectedItemId }) {
  const items = useMemo(() => allItems.filter(it => !NON_GARMENT.has(it.garment_type)), [allItems]);
  const supabase = createClient();
  const [localFields, setLocalFields] = useState({});
  const [proofStatus, setProofStatus] = useState({});
  const saveTimers = useRef({});
  const pendingSaves = useRef({});
  const [ssSyncing, setSsSyncing] = useState(false);
  const [ssResult, setSsResult] = useState(null); // { matched, total } or error string

  // Save pending changes on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingSaves.current).forEach(fn => { if (typeof fn === "function") fn(); });
    };
  }, []);

  // Load proof status
  useEffect(() => {
    if (!items.length) return;
    const ids = items.map(it => it.id);
    supabase.from("item_files").select("item_id, stage, approval").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
      const status = {};
      for (const it of items) {
        const proofs = (data || []).filter(f => f.item_id === it.id && f.stage === "proof");
        const manualApproved = it.artwork_status === "approved";
        status[it.id] = {
          hasProof: proofs.length > 0 || manualApproved,
          allApproved: manualApproved || (proofs.length > 0 && proofs.every(f => f.approval === "approved")),
        };
      }
      setProofStatus(status);
    });
  }, [items]);

  // Initialize fields — only for items not already in localFields
  useEffect(() => {
    setLocalFields(prev => {
      const next = { ...prev };
      let changed = false;
      items.forEach(it => {
        if (!next[it.id]) {
          next[it.id] = {
            blanks_order_number: it.blanks_order_number || "",
            blanks_order_cost: it.blanks_order_cost || "",
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
      const dbVal = field === "blanks_order_cost" ? (parseFloat(String(value).replace(/[^0-9.\-]/g, "")) || null) : (value || null);
      await supabase.from("items").update({ [field]: dbVal }).eq("id", itemId);
      if (onUpdateItem) onUpdateItem(itemId, { [field]: dbVal });
      if (field === "blanks_order_cost" && dbVal && dbVal > 0) {
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

  // ── S&S Orders sync ──
  const ssItems = useMemo(() => items.filter(it =>
    !it.blank_vendor || it.blank_vendor === "S&S Activewear" || it.blank_vendor?.startsWith("S&S")
  ), [items]);
  const hasSSItems = ssItems.length > 0;

  async function syncSSOrders() {
    if (!job?.job_number || ssSyncing) return;
    setSsSyncing(true);
    setSsResult(null);
    try {
      // Fetch orders matching this project's job number as PO number
      const res = await fetch(`/api/ss?endpoint=orders&po=${encodeURIComponent(job.job_number)}`);
      if (!res.ok) throw new Error("Failed to fetch S&S orders");
      const orders = await res.json();

      // S&S returns array of orders (or single object)
      const orderList = Array.isArray(orders) ? orders : orders ? [orders] : [];
      if (orderList.length === 0) {
        setSsResult({ matched: 0, total: 0, message: `No S&S orders found for PO ${job.job_number}` });
        setSsSyncing(false);
        return;
      }

      let matched = 0;

      for (const order of orderList) {
        const orderNumber = order.orderNumber || order.OrderNumber || order.order_number || "";
        const orderTotal = order.total || order.Total || order.orderTotal || 0;
        const poNumber = order.poNumber || order.PONumber || order.po_number || "";
        const trackingNumber = order.trackingNumber || order.TrackingNumber || "";
        const carrier = order.shippingCarrier || order.ShippingCarrier || "";
        const status = order.orderStatus || order.OrderStatus || order.status || "";

        // Match to items: PO number might be "HPD-2603-014" (whole project)
        // or "HPD-2603-014A" (specific item letter)
        const itemLetter = poNumber.replace(job.job_number, "").trim().toUpperCase();

        let matchedItems = [];
        if (itemLetter && itemLetter.length === 1) {
          // Specific item: match by letter index (A=0, B=1, etc)
          const idx = itemLetter.charCodeAt(0) - 65;
          if (idx >= 0 && idx < ssItems.length) {
            matchedItems = [ssItems[idx]];
          }
        } else if (ssItems.length === 1) {
          // Only one S&S item — auto-match
          matchedItems = [ssItems[0]];
        } else {
          // Multiple items, no letter suffix — try to match by line items in order
          // For now, apply to all S&S items that don't have an order yet
          matchedItems = ssItems.filter(it => {
            const v = localFields[it.id]?.blanks_order_cost;
            const n = v ? parseFloat(String(v).replace(/[^0-9.\-]/g, "")) : 0;
            return n <= 0;
          });
          if (matchedItems.length === 0) matchedItems = ssItems;
        }

        for (const item of matchedItems) {
          if (!item) continue;
          const updates = {};

          if (orderNumber) {
            updates.blanks_order_number = String(orderNumber);
            setLocalFields(p => ({ ...p, [item.id]: { ...p[item.id], blanks_order_number: String(orderNumber) } }));
            await supabase.from("items").update({ blanks_order_number: String(orderNumber) }).eq("id", item.id);
            if (onUpdateItem) onUpdateItem(item.id, { blanks_order_number: String(orderNumber) });
          }

          if (orderTotal) {
            const cost = typeof orderTotal === "string" ? parseFloat(orderTotal) : orderTotal;
            if (cost > 0) {
              const costStr = cost.toFixed(2);
              setLocalFields(p => ({ ...p, [item.id]: { ...p[item.id], blanks_order_cost: costStr } }));
              await supabase.from("items").update({ blanks_order_cost: cost }).eq("id", item.id);
              if (onUpdateItem) onUpdateItem(item.id, { blanks_order_cost: cost });
            }
          }

          // If shipped, save tracking
          if (trackingNumber && (status === "Shipped" || status === "Delivered")) {
            await supabase.from("items").update({
              incoming_goods: `S&S shipped${carrier ? ` via ${carrier}` : ""} — tracking: ${trackingNumber}`,
            }).eq("id", item.id);
            if (onUpdateItem) onUpdateItem(item.id, { incoming_goods: `S&S shipped${carrier ? ` via ${carrier}` : ""} — tracking: ${trackingNumber}` });
          }

          matched++;
          logJobActivity(job.id, `S&S order synced for ${item.name} — Order #${orderNumber}${orderTotal ? `, $${parseFloat(orderTotal).toFixed(2)}` : ""}${status ? `, status: ${status}` : ""}`);
        }
      }

      setSsResult({ matched, total: orderList.length, message: `${matched} item${matched !== 1 ? "s" : ""} synced from ${orderList.length} S&S order${orderList.length !== 1 ? "s" : ""}` });
      if (onRecalcPhase) onRecalcPhase();
    } catch (err) {
      console.error("S&S sync error:", err);
      setSsResult({ matched: 0, total: 0, message: `Sync failed: ${err.message}` });
    }
    setSsSyncing(false);
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

  const allProofsApproved = items.length > 0 && items.every(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved");
  const gatesMet = quoteApproved && paymentGateMet && allProofsApproved;

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No apparel items — continue to PO.</div>;
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Gate status */}
      {!gatesMet && (
        <div style={{ background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.amber, marginBottom: 6 }}>Before ordering blanks:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: quoteApproved ? T.green : T.red }}>{quoteApproved ? "✓" : "✕"}</span>
              <span style={{ color: quoteApproved ? T.muted : T.text }}>Quote approved</span>
            </div>
            {!isNetTerms && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: paymentGateMet ? T.green : T.red }}>{paymentGateMet ? "✓" : "✕"}</span>
                <span style={{ color: paymentGateMet ? T.muted : T.text }}>
                  {terms === "prepaid" ? "Full payment received" : "Deposit received"}
                  {!paymentGateMet && <> (add on <a onClick={e=>{e.preventDefault();if(onTabClick)onTabClick("proofs");}} style={{color:T.accent,cursor:"pointer",textDecoration:"underline"}}>Proofs & Invoice</a> tab)</>}
                </span>
              </div>
            )}
            {isNetTerms && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: T.green }}>✓</span>
                <span style={{ color: T.muted }}>Net terms — no payment required</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: allProofsApproved ? T.green : T.red }}>{allProofsApproved ? "✓" : "✕"}</span>
              <span style={{ color: allProofsApproved ? T.muted : T.text }}>All proofs approved ({items.filter(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved").length}/{items.length})</span>
            </div>
          </div>
        </div>
      )}

      {gatesMet && (
        <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.green, fontWeight: 600 }}>
          All gates met — ready to order blanks
        </div>
      )}

      {/* S&S sync button — only for projects with S&S items */}
      {hasSSItems && job?.job_number && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <button
            onClick={syncSSOrders}
            disabled={ssSyncing}
            style={{
              background: T.accent, border: "none", borderRadius: 6,
              color: "#fff", fontSize: 11, fontWeight: 600, padding: "6px 14px",
              cursor: ssSyncing ? "default" : "pointer", opacity: ssSyncing ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {ssSyncing ? "Syncing..." : "Sync S&S Orders"}
          </button>
          <span style={{ fontSize: 10, color: T.muted }}>
            Auto-fill order numbers, costs & tracking from S&S using PO #{job.job_number}
          </span>
          {ssResult && (
            <span style={{ fontSize: 10, fontWeight: 600, color: ssResult.matched > 0 ? T.green : T.amber, marginLeft: "auto" }}>
              {ssResult.message}
            </span>
          )}
        </div>
      )}

      {/* Cost variance summary */}
      {(()=>{
        let totalExpected = 0, totalActual = 0, hasAny = false;
        items.forEach(item => {
          const f = localFields[item.id] || {};
          const totalUnits = tQty(item.qtys || {});
          // Expected: use per-size blank costs if available, else cost_per_unit
          let calcCost = 0;
          if (item.blank_costs && Object.keys(item.blank_costs).length > 0) {
            calcCost = Object.entries(item.blank_costs).reduce((a, [sz, c]) => a + (parseFloat(c) || 0) * (item.qtys?.[sz] || 0), 0);
          } else if (item.cost_per_unit != null) {
            calcCost = item.cost_per_unit * totalUnits;
          }
          const actualCost = f.blanks_order_cost ? parseFloat(String(f.blanks_order_cost).replace(/[^0-9.\-]/g, "")) : 0;
          totalExpected += calcCost;
          totalActual += actualCost;
          if (actualCost > 0) hasAny = true;
        });
        if (!hasAny) return null;
        const variance = totalActual - totalExpected;
        const color = variance === 0 ? T.muted : variance > 0 ? T.red : T.green;
        return (
          <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <div><div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Expected</div><div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: mono }}>${totalExpected.toFixed(2)}</div></div>
            <div><div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Actual</div><div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: mono }}>${totalActual.toFixed(2)}</div></div>
            <div><div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Variance</div><div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: mono }}>{variance >= 0 ? "+" : ""}${variance.toFixed(2)}</div></div>
          </div>
        );
      })()}

      {/* Item list — single tight row per item. QB invoice # is the
          primary identifier (front and center), brand/style/color
          combined with no individual labels, sizes inline, order total
          input on the right with variance pill. */}
      <div style={{ ...card }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "32px 90px 1fr 150px 160px", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface, fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          <div></div>
          <div>QB Invoice</div>
          <div>Brand · Style · Color · Sizes</div>
          <div>Order total</div>
          <div style={{ textAlign: "right" }}>Status</div>
        </div>
        {items.map((item, i) => {
          if (selectedItemId && item.id !== selectedItemId) return null;
          const f = localFields[item.id] || {};
          const totalUnits = tQty(item.qtys || {});
          const calcCost = item.cost_per_unit != null ? (item.cost_per_unit * totalUnits) : null;
          const actualCost = f.blanks_order_cost ? parseFloat(String(f.blanks_order_cost).replace(/[^0-9.\-]/g, "")) : null;
          const costDiff = calcCost !== null && actualCost !== null ? actualCost - calcCost : null;
          const hasOrder = (actualCost ?? 0) > 0;
          const itemLetter = String.fromCharCode(65 + i);
          // QB invoice # is the primary reference for ordering. Format
          // matches the PO PDF naming: invoice number + item letter.
          const qbInvNum = job?.type_meta?.qb_invoice_number;
          const qbRef = qbInvNum ? `#${qbInvNum}${itemLetter}` : null;
          const fallbackRef = `${job?.job_number || ""}${itemLetter}`;
          const blankInfo = [item.blank_vendor, item.blank_sku, item.color || item.blank_color].filter(Boolean).join(" · ");
          const isLast = i === items.length - 1;

          return (
            <div key={item.id} style={{
              display: "grid", gridTemplateColumns: "32px 90px 1fr 150px 160px",
              gap: 12, padding: "10px 14px", alignItems: "center",
              borderBottom: isLast ? "none" : `1px solid ${T.border}`,
              background: hasOrder ? T.greenDim + "33" : "transparent",
            }}>
              {/* Letter */}
              <span style={{ width: 28, height: 28, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: T.accent, fontFamily: mono }}>
                {itemLetter}
              </span>
              {/* QB invoice ref */}
              <div style={{ fontSize: 14, fontWeight: 700, color: qbInvNum ? T.text : T.faint, fontFamily: mono }}>
                {qbRef || <span title={`OpsHub job number — push to QB to get an invoice #`} style={{ fontSize: 11 }}>{fallbackRef}</span>}
              </div>
              {/* Blank info + sizes inline — the meat of the row */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{blankInfo || "—"}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.muted, fontFamily: mono, flexWrap: "wrap" }}>
                  {(item.sizes || []).filter(sz => (item.qtys || {})[sz] > 0).map(sz => (
                    <span key={sz}><span style={{ color: T.faint, marginRight: 3 }}>{sz}</span><span style={{ color: T.text, fontWeight: 600 }}>{(item.qtys || {})[sz].toLocaleString()}</span></span>
                  ))}
                  <span style={{ color: T.faint }}>· {totalUnits.toLocaleString()} units</span>
                </div>
              </div>
              {/* Order total input — sized for $100,000.00, right-aligned */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>$</span>
                  <input style={{ width: 110, padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.surface, color: T.text, fontSize: 13, fontFamily: mono, fontWeight: 600, outline: "none", textAlign: "right" }} type="text" inputMode="decimal" value={f.blanks_order_cost || ""} placeholder="0.00"
                    onChange={e => updateField(item.id, "blanks_order_cost", e.target.value)}
                    onFocus={e => e.target.select()} />
                </div>
                {calcCost !== null && (
                  <div style={{ fontSize: 9, color: T.faint, marginTop: 3, fontFamily: mono }}>calc ${calcCost.toFixed(2)}</div>
                )}
              </div>
              {/* Variance + Ordered badge */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                {calcCost !== null && actualCost !== null && actualCost > 0 && (
                  <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: costDiff > 0 ? T.red : costDiff < 0 ? T.green : T.muted, padding: "3px 8px", background: costDiff === 0 ? T.surface : (costDiff > 0 ? T.redDim : T.greenDim), borderRadius: 4 }}>
                    {costDiff === 0 ? "match" : (costDiff > 0 ? "+" : "") + "$" + Math.abs(costDiff).toFixed(2)}
                  </span>
                )}
                {hasOrder && <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: T.greenDim, color: T.green, whiteSpace: "nowrap" }}>Ordered ✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary — counts items where the order total has been entered. */}
      <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>
        {items.filter(it => {
          const v = localFields[it.id]?.blanks_order_cost;
          const n = v ? parseFloat(String(v).replace(/[^0-9.\-]/g, "")) : 0;
          return n > 0;
        }).length}/{items.length} items ordered
      </div>
    </div>
  );
}
