"use client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty, FULFILLMENT_STAGES } from "@/lib/use-warehouse";

export default function FulfillmentPage() {
  const { loading, fulfillment, undoReceived, updateFulfillment, debounceFulfillmentTracking } = useWarehouse();

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fulfillment</h1>
        {fulfillment.length > 0 && <span style={{ fontSize: 12, color: T.muted }}>{fulfillment.length} orders staged</span>}
      </div>

      {fulfillment.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No orders in fulfillment. Staged orders appear here after all items are received.
        </div>
      ) : (
        fulfillment.map(job => {
          const si = FULFILLMENT_STAGES.findIndex(s => s.id === job.fulfillment_status);
          return (
            <div key={job.id} style={card}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.job_number}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted }}>{job.items.length} items · {job.items.reduce((a, it) => a + tQty(it.qtys), 0).toLocaleString()} units</span>
              </div>
              <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {FULFILLMENT_STAGES.map((stage, idx) => {
                    const done = si >= idx, active = job.fulfillment_status === stage.id;
                    return (
                      <button key={stage.id} onClick={() => updateFulfillment(job.id, stage.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6,
                          fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                          border: `1px solid ${done ? stage.color + "66" : T.border}`,
                          background: active ? stage.color + "22" : done ? stage.color + "11" : "transparent",
                          color: done ? stage.color : T.muted,
                        }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: done ? stage.color : T.faint }} />
                        {stage.label}
                      </button>
                    );
                  })}
                </div>

                {job.shipping_notes && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Shipping Notes</div>
                    <div style={{ fontSize: 11, color: T.amber, padding: "6px 10px", background: T.amberDim, borderRadius: 6 }}>{job.shipping_notes}</div>
                  </div>
                )}

                {(job.fulfillment_status === "shipped" || job.fulfillment_status === "packing") && (
                  <div>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Outbound tracking</label>
                    <input style={{ ...ic, fontFamily: mono }} value={job.fulfillment_tracking || ""} placeholder="Enter tracking number"
                      onChange={e => debounceFulfillmentTracking(job.id, e.target.value)} />
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {job.items.map(item => (
                    <span key={item.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: T.surface, color: T.muted, cursor: "pointer" }}
                      onClick={() => undoReceived(item)}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f5a623"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.muted; }}
                      title="Click to revert to incoming">
                      {item.name} · {tQty(item.qtys)} units
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
