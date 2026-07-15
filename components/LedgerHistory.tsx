"use client";
// The audit trail for one item: every quantity that moved, in order, with
// who / when / how many / tracking / source. Reads the append-only movement
// ledger (migration 119) — this is the "referenceable at each stage" record.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { type Movement } from "@/lib/inventory-ledger";
import { deriveItem } from "@/lib/item-derivation";

const TYPE_META: Record<string, { label: string; color: string }> = {
  ship: { label: "Shipped from vendor", color: T.green },
  receive: { label: "Received at HPD", color: T.blue },
  forward: { label: "Forwarded to client", color: "#c2477e" },
  stage: { label: "Entered into Shopify", color: "#b5892a" },
  pull: { label: "Pulled / held back", color: "#7a52c4" },
  adjust: { label: "Adjustment", color: T.faint },
};
const SOURCE_LABEL: Record<string, string> = {
  app: "", legacy: "pre-ledger", backfill: "pre-ledger · est", import: "imported",
};
const tsum = (q: Record<string, number>) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const fmtQtys = (q: Record<string, number>) =>
  Object.entries(q || {}).filter(([, n]) => n).map(([s, n]) => `${s} ${n > 0 ? n : n}`).join("  ·  ");
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};

export default function LedgerHistory({ itemId, itemName, onClose }: { itemId: string; itemName: string; onClose: () => void }) {
  const [movs, setMovs] = useState<Movement[] | null>(null);
  const [ordered, setOrdered] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<{ route: any; shipFinal: boolean }>({ route: "ship_through", shipFinal: false });

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [{ data: m }, { data: bsl }, { data: it }] = await Promise.all([
        sb.from("movements").select("*").eq("item_id", itemId).order("created_at", { ascending: true }),
        sb.from("buy_sheet_lines").select("size, qty_ordered").eq("item_id", itemId),
        sb.from("items").select("ship_final, shipping_route, jobs(shipping_route)").eq("id", itemId).single(),
      ]);
      setOrdered(Object.fromEntries((bsl || []).map((l: any) => [l.size, Number(l.qty_ordered) || 0])));
      setMeta({ route: ((it as any)?.shipping_route || (it as any)?.jobs?.shipping_route || "ship_through"), shipFinal: !!(it as any)?.ship_final });
      setMovs((m || []) as Movement[]);
    })();
  }, [itemId]);

  // Correct model (handles pulls): on-hand = received − pulled − forwarded − entered.
  const st = movs ? deriveItem({ ordered, route: meta.route, shipFinal: meta.shipFinal, movements: movs as any }) : null;
  const reversedIds = new Set((movs || []).filter(m => m.reverses_id).map(m => m.reverses_id));

  const stat = (label: string, value: number, color?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: color || T.text, fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: "100%", maxWidth: 620, maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", fontFamily: font }}>
        {/* header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Movement history</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginTop: 2 }}>{itemName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* summary strip */}
        {st && (
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, background: T.surface + "55", display: "flex", gap: 26, flexWrap: "wrap" }}>
            {stat("Ordered", st.orderedTotal)}
            {stat("Shipped", st.shippedTotal, st.fullyShipped ? T.green : T.amber)}
            {st.owedTotal > 0 && stat("Owed", st.owedTotal, T.amber)}
            {stat("Received", st.receivedTotal, T.blue)}
            {st.pulledTotal > 0 && stat("Pulled", st.pulledTotal, "#7a52c4")}
            {st.forwardedTotal > 0 && stat("Forwarded", st.forwardedTotal, "#c2477e")}
            {stat("On hand", st.onHandTotal)}
            {st.closed && st.shippedTotal > st.receivedTotal && stat("Not received", st.shippedTotal - st.receivedTotal, T.amber)}
          </div>
        )}

        {/* timeline */}
        <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
          {!movs && <div style={{ padding: 30, textAlign: "center", color: T.faint }}>Loading…</div>}
          {movs && movs.length === 0 && <div style={{ padding: 30, textAlign: "center", color: T.faint }}>No movements yet — nothing has shipped.</div>}
          {(movs || []).map((m) => {
            const meta = TYPE_META[m.type] || TYPE_META.adjust;
            const total = tsum(m.qtys);
            const isReversal = !!m.reverses_id;
            const wasReversed = reversedIds.has(m.id);
            const src = SOURCE_LABEL[m.source] || m.source;
            return (
              <div key={m.id} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: `1px solid ${T.border}55`, opacity: wasReversed ? 0.5 : 1 }}>
                <div style={{ width: 8, height: 8, borderRadius: 8, background: isReversal ? T.faint : meta.color, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isReversal ? T.faint : meta.color, textDecoration: wasReversed ? "line-through" : "none" }}>
                      {isReversal ? "Reversed" : meta.label}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: T.text, fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
                      {total > 0 ? "+" : ""}{total}
                    </span>
                    {src && <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.04em", background: T.surface, padding: "1px 6px", borderRadius: 99 }}>{src}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.muted, fontFamily: mono, marginTop: 2 }}>{fmtQtys(m.qtys)}</div>
                  <div style={{ fontSize: 11, color: T.faint, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>{fmtDate(m.created_at)}</span>
                    {m.created_by_name && <span>· {m.created_by_name}</span>}
                    {m.tracking && <span>· {m.tracking}</span>}
                  </div>
                  {m.reason && <div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontStyle: "italic" }}>{m.reason}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
