import { createClient } from "@/lib/supabase/server";
import { T, mono, sortSizes } from "@/lib/theme";

export const dynamic = "force-dynamic";

// The frozen client packing slip — renders the outbound shipment's manifest
// (shipment_lines, which don't change after forward = frozen). Referenceable
// later via /shipping2/slip/[shipmentId].
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const tsum = (q: Record<string, number>) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

export default async function PackingSlipPage({ params }: { params: { shipmentId: string } }) {
  const sb = await createClient();
  const { data: ship } = await sb.from("shipments").select("id, carrier, tracking, created_at, direction").eq("id", params.shipmentId).single();
  const { data: lines } = await sb.from("shipment_lines")
    .select("item_id, description, ship_qtys, items(name, mockup_color, jobs(job_number, title, clients(name, shipping_address)))")
    .eq("shipment_id", params.shipmentId);

  if (!ship) return <div style={{ padding: 40, fontFamily: "sans-serif" }}>Shipment not found.</div>;
  const first: any = (lines || [])[0];
  const client = first?.items?.jobs?.clients?.name || "—";
  const shipTo = first?.items?.jobs?.clients?.shipping_address || "";
  const jobNumber = first?.items?.jobs?.job_number || "";
  const jobTitle = first?.items?.jobs?.title || "";
  const total = (lines || []).reduce((a: number, l: any) => a + tsum(l.ship_qtys), 0);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px", fontFamily: "-apple-system,Segoe UI,Roboto,sans-serif", color: "#1c1e23", background: "#fff" }}>
      <style>{`@media print{@page{margin:14mm}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #1c1e23", paddingBottom: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>House Party Distro</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Packing Slip</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "#6b7280" }}>
          <div><b style={{ color: "#1c1e23" }}>{jobNumber}</b>{jobTitle ? ` · ${jobTitle}` : ""}</div>
          <div>{fmt(ship.created_at)}</div>
          <div style={{ fontFamily: mono }}>{[ship.carrier, ship.tracking].filter(Boolean).join(" · ") || "no tracking"}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 40, marginBottom: 22, fontSize: 13 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: "#9aa0ac", marginBottom: 4 }}>Ship to</div>
          <div style={{ fontWeight: 700 }}>{client}</div>
          {shipTo && <div style={{ color: "#6b7280", whiteSpace: "pre-line", marginTop: 2 }}>{shipTo}</div>}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #dcdce0", textAlign: "left" }}>
            <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "#9aa0ac" }}>Item</th>
            <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "#9aa0ac" }}>Sizes</th>
            <th style={{ padding: "8px 6px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "#9aa0ac", textAlign: "right" }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {(lines || []).map((l: any, i: number) => {
            const q = l.ship_qtys || {};
            const sizes = sortSizes(Object.keys(q));
            return (
              <tr key={i} style={{ borderBottom: "1px solid #eef0f3" }}>
                <td style={{ padding: "9px 6px", fontWeight: 600 }}>{l.items?.name || l.description || "Item"}</td>
                <td style={{ padding: "9px 6px", fontFamily: mono, color: "#6b7280" }}>{sizes.map(s => `${s} ${q[s]}`).join("  ·  ")}</td>
                <td style={{ padding: "9px 6px", fontFamily: mono, fontWeight: 700, textAlign: "right" }}>{tsum(q)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid #1c1e23" }}>
            <td colSpan={2} style={{ padding: "10px 6px", fontWeight: 700 }}>Total units</td>
            <td style={{ padding: "10px 6px", fontFamily: mono, fontWeight: 800, textAlign: "right" }}>{total}</td>
          </tr>
        </tfoot>
      </table>

      <div style={{ marginTop: 30, fontSize: 11, color: "#9aa0ac" }}>Frozen at forward — this is the record of what shipped.</div>
    </div>
  );
}
