"use client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";

export default function ReceivingPage() {
  const { loading, incoming, updateReceivedQty, markReceived, undoReceived } = useWarehouse();

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const itemCount = incoming.reduce((a, j) => a + j.items.filter(it => !it.received_at_hpd).length, 0);

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Receiving</h1>
        {itemCount > 0 && <span style={{ fontSize: 12, color: T.muted }}>{itemCount} items incoming</span>}
      </div>

      {incoming.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No incoming items. Items appear here when shipped from decorator.
        </div>
      ) : (
        incoming.map(job => (
          <div key={job.id} style={card}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
              <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
              <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.job_number}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 99, background: job.shipping_route === "stage" ? "#2d1f5e" : "#1e2a4a", color: job.shipping_route === "stage" ? "#a78bfa" : T.accent }}>
                {job.shipping_route === "stage" ? "Stage" : "Ship-through"}
              </span>
            </div>
            <div style={{ padding: "10px 14px" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {["Item", "Tracking", "Shipped → Received", "Status", ""].map(h =>
                      <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {job.items.map((item, i) => {
                    const shippedQty = tQty(item.ship_qtys);
                    const totalQty = tQty(item.qtys);
                    const receivedTotal = tQty(item.received_qtys);
                    const hasVariance = item.received_at_hpd && receivedTotal > 0 && receivedTotal !== (shippedQty || totalQty);
                    return (
                      <tr key={item.id} style={{ borderBottom: i < job.items.length - 1 ? `1px solid ${T.border}` : "none", verticalAlign: "top" }}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>
                          {item.name}
                          <div style={{ fontSize: 10, color: T.faint, fontWeight: 400 }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td style={{ padding: "8px", fontFamily: mono, fontSize: 11, color: T.muted }}>{item.ship_tracking || "—"}</td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {item.sizes.map(sz => {
                              const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                              const received = item.received_qtys?.[sz] ?? shipped;
                              const mismatch = item.received_at_hpd && received !== shipped;
                              return (
                                <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                  <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{sz}</span>
                                  <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{shipped}</span>
                                  <input type="number" min="0" value={received}
                                    onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                    onFocus={e => e.target.select()}
                                    style={{ width: 36, textAlign: "center", padding: "2px", border: `1px solid ${mismatch ? T.red : T.border}`, borderRadius: 3, background: T.surface, color: mismatch ? T.red : T.text, fontSize: 10, fontFamily: mono, outline: "none" }} />
                                </div>
                              );
                            })}
                          </div>
                          {hasVariance && <div style={{ fontSize: 9, color: T.red, marginTop: 4 }}>Variance: {receivedTotal - (shippedQty || totalQty)} units</div>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {item.received_at_hpd ? (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: hasVariance ? T.amberDim : T.greenDim, color: hasVariance ? T.amber : T.green }}>{hasVariance ? "Variance" : "Received"}</span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.surface, color: T.muted }}>Pending</span>
                          )}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          {item.received_at_hpd ? (
                            <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Undo</button>
                          ) : (
                            <button onClick={() => markReceived(item)} style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Confirm</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
