"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER, sortSizes } from "@/lib/theme";

type VarianceRow = {
  id: string;
  name: string;
  blankVendor: string | null;
  orderedPerSize: Record<string, number>;
  actualPerSize: Record<string, number>;
  orderedTotal: number;
  actualTotal: number;
  sellPerUnit: number;
  orderedRevenue: number;
  actualRevenue: number;
};

export function InvoiceVarianceReviewModal({
  jobId,
  shippingRoute,
  jobTitle,
  clientName,
  onClose,
  onApproved,
}: {
  jobId: string;
  shippingRoute: "drop_ship" | "ship_through" | "stage" | null;
  jobTitle: string;
  clientName: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<VarianceRow[] | null>(null);
  const [billableQtys, setBillableQtys] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useReceivedQtys = shippingRoute === "ship_through" || shippingRoute === "stage";

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: items } = await supabase
        .from("items")
        .select("id, name, blank_vendor, sell_per_unit, ship_qtys, received_qtys, buy_sheet_lines(size, qty_ordered)")
        .eq("job_id", jobId)
        .order("sort_order");

      const built: VarianceRow[] = ((items as any) || []).map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const orderedPerSize: Record<string, number> = {};
        for (const l of lines) orderedPerSize[l.size] = l.qty_ordered || 0;

        const actualSource: Record<string, number> = useReceivedQtys
          ? (it.received_qtys || {})
          : (it.ship_qtys || {});
        const actualPerSize: Record<string, number> = {};
        for (const sz of Object.keys(orderedPerSize)) {
          actualPerSize[sz] = actualSource[sz] ?? 0;
        }

        const orderedTotal = Object.values(orderedPerSize).reduce((a, q) => a + q, 0);
        const actualTotal = Object.values(actualPerSize).reduce((a, q) => a + q, 0);
        const sellPerUnit = parseFloat(it.sell_per_unit) || 0;
        return {
          id: it.id,
          name: it.name || "",
          blankVendor: it.blank_vendor || null,
          orderedPerSize,
          actualPerSize,
          orderedTotal,
          actualTotal,
          sellPerUnit,
          orderedRevenue: orderedTotal * sellPerUnit,
          actualRevenue: actualTotal * sellPerUnit,
        };
      });
      setRows(built);
      // Seed billableQtys with the actual (shipped/received) total per item — user can edit or waive
      const seed: Record<string, number> = {};
      built.forEach(r => { seed[r.id] = r.actualTotal; });
      setBillableQtys(seed);
      setLoading(false);
    })();
  }, [jobId, useReceivedQtys]);

  async function approveAndPush() {
    setPushing(true);
    setError(null);
    try {
      const res = await fetch("/api/qb/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, useShippedQtys: true, billableQtys }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Push failed");
        setPushing(false);
        return;
      }
      onApproved();
      onClose();
    } catch (e: any) {
      setError(e.message || "Push failed");
      setPushing(false);
    }
  }

  function setBillable(itemId: string, qty: number) {
    setBillableQtys(p => ({ ...p, [itemId]: Math.max(0, Math.floor(Number(qty) || 0)) }));
  }

  function waiveRow(row: VarianceRow) {
    // Waive = bill at ordered qty, absorbing the extra we shipped
    setBillable(row.id, row.orderedTotal);
  }

  const totalOrdered = rows?.reduce((a, r) => a + r.orderedTotal, 0) || 0;
  const totalActual = rows?.reduce((a, r) => a + r.actualTotal, 0) || 0;
  const totalOrderedRev = rows?.reduce((a, r) => a + r.orderedRevenue, 0) || 0;
  // Billable revenue uses the editable billableQtys (defaults to actualTotal)
  const totalBillable = rows?.reduce((a, r) => a + (billableQtys[r.id] ?? r.actualTotal), 0) || 0;
  const totalBillableRev = rows?.reduce((a, r) => a + (billableQtys[r.id] ?? r.actualTotal) * r.sellPerUnit, 0) || 0;
  const totalDelta = totalBillableRev - totalOrderedRev;

  const fmt$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, maxWidth: 960, width: "100%", maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Review invoice variance</div>
            <div style={{ fontSize: 11, color: T.muted }}>
              {clientName ? `${clientName} · ` : ""}{jobTitle} · using {useReceivedQtys ? "HPD received" : "decorator shipped"} qtys
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", padding: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {loading && <div style={{ color: T.muted, fontSize: 12, padding: 20, textAlign: "center" }}>Loading variance…</div>}

          {!loading && rows && rows.length === 0 && (
            <div style={{ color: T.muted, fontSize: 12, padding: 20, textAlign: "center" }}>No items on this project.</div>
          )}

          {!loading && rows && rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1.5px solid ${T.text}` }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Item</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Quoted qty</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{useReceivedQtys ? "Received" : "Shipped"}</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Billable</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Δ</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Unit $</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Quoted $</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>New $</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const billable = billableQtys[r.id] ?? r.actualTotal;
                  const billableRev = billable * r.sellPerUnit;
                  // Δ is vs quoted (what we originally invoiced)
                  const qtyDelta = billable - r.orderedTotal;
                  const revDelta = billableRev - r.orderedRevenue;
                  const deltaColor = qtyDelta === 0 ? T.faint : qtyDelta > 0 ? T.green : T.red;
                  const sortedSizes = sortSizes(Object.keys(r.orderedPerSize));
                  const overship = r.actualTotal > r.orderedTotal;
                  const waived = overship && billable === r.orderedTotal;
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</div>
                        {r.blankVendor && <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{r.blankVendor}</div>}
                        <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 4 }}>
                          {sortedSizes.map((sz) => {
                            const o = r.orderedPerSize[sz] || 0;
                            const a = r.actualPerSize[sz] || 0;
                            const changed = o !== a;
                            return (
                              <span key={sz} style={{ marginRight: 8, color: changed ? T.amber : T.faint }}>
                                {sz}: {o}{changed ? `→${a}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, color: T.muted }}>{r.orderedTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, color: T.muted }}>{r.actualTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                          <input
                            type="number"
                            min="0"
                            value={billable}
                            onChange={(e) => setBillable(r.id, parseInt(e.target.value || "0", 10))}
                            onFocus={(e) => e.target.select()}
                            style={{ width: 64, textAlign: "right", padding: "4px 6px", border: `1px solid ${billable !== r.actualTotal ? T.accent : T.border}`, borderRadius: 4, background: T.card, color: T.text, fontSize: 12, fontFamily: mono, outline: "none", fontWeight: 700 }}
                          />
                          {overship && !waived && (
                            <button
                              onClick={() => waiveRow(r)}
                              title="Waive overage — bill at quoted quantity"
                              style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${T.amber}`, color: T.amber, borderRadius: 4, fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: font }}
                            >Waive</button>
                          )}
                          {waived && (
                            <span style={{ fontSize: 9, color: T.amber, fontWeight: 600, fontFamily: font }}>waived</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, color: deltaColor, fontWeight: 700 }}>
                        {qtyDelta > 0 ? `+${qtyDelta}` : qtyDelta}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, color: T.faint }}>{fmt$(r.sellPerUnit)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, color: T.muted }}>{fmt$(r.orderedRevenue)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>
                        {fmt$(billableRev)}
                        {revDelta !== 0 && (
                          <div style={{ fontSize: 9, color: revDelta > 0 ? T.green : T.red, fontWeight: 600 }}>
                            {revDelta > 0 ? "+" : ""}{fmt$(revDelta)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.text}`, background: T.surface }}>
                  <td style={{ padding: "10px 8px", fontWeight: 700 }}>Total</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{totalOrdered.toLocaleString()}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{totalActual.toLocaleString()}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{totalBillable.toLocaleString()}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700, color: totalBillable === totalOrdered ? T.faint : totalBillable > totalOrdered ? T.green : T.red }}>
                    {totalBillable - totalOrdered > 0 ? "+" : ""}{(totalBillable - totalOrdered).toLocaleString()}
                  </td>
                  <td />
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>{fmt$(totalOrderedRev)}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: mono, fontWeight: 700 }}>
                    {fmt$(totalBillableRev)}
                    {totalDelta !== 0 && (
                      <div style={{ fontSize: 10, color: totalDelta > 0 ? T.green : T.red, fontWeight: 700 }}>
                        {totalDelta > 0 ? "+" : ""}{fmt$(totalDelta)}
                      </div>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, color: T.muted }}>
            Approving pushes updated qtys to QuickBooks and emails the client the revised invoice.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {error && <span style={{ color: T.red, fontSize: 11 }}>{error}</span>}
            <button
              onClick={onClose}
              disabled={pushing}
              style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, fontWeight: 600, cursor: pushing ? "default" : "pointer", fontFamily: font }}
            >Cancel</button>
            <button
              onClick={approveAndPush}
              disabled={pushing || loading || !rows?.length}
              style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: pushing ? T.faint : T.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: pushing ? "default" : "pointer", fontFamily: font }}
            >{pushing ? "Pushing…" : "Approve & Push to QB"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
