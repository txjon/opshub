"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";

const tQty = (q) => Object.values(q || {}).reduce((a, v) => a + v, 0);
const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box", outline: "none" };

export function BlanksTab({ items, job, payments, onRecalcPhase }) {
  const supabase = createClient();
  const [localFields, setLocalFields] = useState({});
  const [proofStatus, setProofStatus] = useState({});
  const saveTimers = useRef({});

  // Load proof status
  useEffect(() => {
    if (!items.length) return;
    const ids = items.map(it => it.id);
    supabase.from("item_files").select("item_id, stage, approval").in("item_id", ids).then(({ data }) => {
      const status = {};
      for (const it of items) {
        const proofs = (data || []).filter(f => f.item_id === it.id && f.stage === "proof");
        status[it.id] = {
          hasProof: proofs.length > 0,
          allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved"),
        };
      }
      setProofStatus(status);
    });
  }, [items]);

  // Initialize fields
  useEffect(() => {
    const fields = {};
    items.forEach(it => {
      fields[it.id] = {
        blanks_order_number: it.blanks_order_number || "",
        blanks_order_cost: it.blanks_order_cost || "",
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
      if (field === "blanks_order_number" && value) {
        const item = items.find(it => it.id === itemId);
        if (item) logJobActivity(job.id, `Blanks ordered for ${item.name} — S&S #${value}`);
      }
      if (onRecalcPhase) onRecalcPhase();
    }, 800);
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
    paymentGateMet = true; // Permissive default
  }

  const allProofsApproved = items.length > 0 && items.every(it => proofStatus[it.id]?.allApproved);
  const gatesMet = quoteApproved && paymentGateMet && allProofsApproved;

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };

  if (items.length === 0) {
    return <div style={{ ...card, textAlign: "center", color: T.muted, padding: "2rem", fontSize: 13 }}>No items yet — add items in the Buy Sheet first.</div>;
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
                <span style={{ color: paymentGateMet ? T.muted : T.text }}>{terms === "prepaid" ? "Full payment received" : "Deposit received"}{paymentGateMet ? "" : " (add on Overview tab)"}</span>
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
              <span style={{ color: allProofsApproved ? T.muted : T.text }}>All proofs approved ({items.filter(it => proofStatus[it.id]?.allApproved).length}/{items.length})</span>
            </div>
          </div>
        </div>
      )}

      {gatesMet && (
        <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.green, fontWeight: 600 }}>
          All gates met — ready to order blanks
        </div>
      )}

      {/* Item list */}
      {items.map((item, i) => {
        const f = localFields[item.id] || {};
        const totalUnits = tQty(item.qtys || {});
        const calcCost = item.cost_per_unit ? (item.cost_per_unit * totalUnits) : null;
        const actualCost = f.blanks_order_cost ? parseFloat(f.blanks_order_cost) : null;
        const costDiff = calcCost && actualCost ? actualCost - calcCost : null;
        const hasOrder = !!f.blanks_order_number;

        return (
          <div key={item.id} style={{ ...card, border: `1px solid ${hasOrder ? T.green + "44" : T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                {String.fromCharCode(65 + i)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")} · {totalUnits.toLocaleString()} units</div>
              </div>
              {hasOrder && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>Ordered</span>}
            </div>
            <div style={{ padding: "10px 14px" }}>
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
          </div>
        );
      })}

      {/* Summary */}
      <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>
        {items.filter(it => localFields[it.id]?.blanks_order_number).length}/{items.length} items ordered
      </div>
    </div>
  );
}
